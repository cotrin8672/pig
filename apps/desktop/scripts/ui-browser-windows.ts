import { ptr as addressOf, dlopen, FFIType, type Pointer } from "bun:ffi";
import { resolve } from "node:path";

const { i32, ptr, u32, u64 } = FFIType;
const signature = <T extends FFIType[], R extends FFIType>(
  args: T,
  returns: R,
) => ({
  args,
  returns,
});

function quoteArgument(arg: string) {
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/\\+$/, "$&$&")}"`;
}

/** The runner owns the only job handle, so Windows also cleans up on a hard kill. */
export function launchBrowserInJob(binary: string, args: string[]) {
  const lib = dlopen("kernel32.dll", {
    CreateJobObjectW: signature([ptr, ptr], ptr),
    SetInformationJobObject: signature([ptr, i32, ptr, u32], i32),
    InitializeProcThreadAttributeList: signature([ptr, u32, u32, ptr], i32),
    UpdateProcThreadAttribute: signature(
      [ptr, u32, u64, ptr, u64, ptr, ptr],
      i32,
    ),
    DeleteProcThreadAttributeList: signature([ptr], FFIType.void),
    CreateProcessW: signature(
      [ptr, ptr, ptr, ptr, i32, u32, ptr, ptr, ptr, ptr],
      i32,
    ),
    QueryInformationJobObject: signature([ptr, i32, ptr, u32, ptr], i32),
    TerminateJobObject: signature([ptr, u32], i32),
    CloseHandle: signature([ptr], i32),
    GetLastError: signature([], u32),
  });
  const win = lib.symbols;
  const failure = (api: string) =>
    new Error(`${api}: Windows error ${win.GetLastError()}`);
  const job = win.CreateJobObjectW(null, null);
  if (!job) {
    const error = failure("CreateJobObjectW");
    lib.close();
    throw error;
  }

  try {
    // Windows' 64-bit JOBOBJECT_EXTENDED_LIMIT_INFORMATION: LimitFlags at byte 16.
    const limits = Buffer.alloc(144);
    limits.writeUInt32LE(0x2000, 16); // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if (!win.SetInformationJobObject(job, 9, limits, limits.length))
      throw failure("SetInformationJobObject");

    const size = Buffer.alloc(8);
    win.InitializeProcThreadAttributeList(null, 1, 0, size);
    const bytes = Number(size.readBigUInt64LE());
    if (!bytes) throw failure("InitializeProcThreadAttributeList (size)");
    // The attribute list keeps a pointer to the job value until it is deleted.
    const jobOffset = Math.ceil(bytes / 8) * 8;
    const attributes = Buffer.alloc(jobOffset + 8);
    attributes.writeBigUInt64LE(BigInt(job), jobOffset);
    if (!win.InitializeProcThreadAttributeList(attributes, 1, 0, size))
      throw failure("InitializeProcThreadAttributeList");
    try {
      // Assign at creation, not after spawn: neither the browser nor its children
      // can slip out of the job if Bun is killed during browser startup.
      const jobList = 0x0002000dn; // PROC_THREAD_ATTRIBUTE_JOB_LIST
      if (
        !win.UpdateProcThreadAttribute(
          attributes,
          0,
          jobList,
          attributes.subarray(jobOffset),
          8n,
          null,
          null,
        )
      )
        throw failure("UpdateProcThreadAttribute (job list)");

      const startup = Buffer.alloc(112); // 64-bit STARTUPINFOEXW
      const info = Buffer.alloc(24); // 64-bit PROCESS_INFORMATION
      startup.writeUInt32LE(startup.length);
      startup.writeBigUInt64LE(BigInt(addressOf(attributes)), 104);
      const exe = resolve(binary);
      const application = Buffer.from(`${exe}\0`, "utf16le");
      const command = Buffer.from(
        `${[exe, ...args].map(quoteArgument).join(" ")}\0`,
        "utf16le",
      );
      const flags = 0x08080000; // CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT
      if (
        !win.CreateProcessW(
          application,
          command,
          null,
          null,
          0,
          flags,
          null,
          null,
          startup,
          info,
        )
      )
        throw failure("CreateProcessW");
      win.CloseHandle(Number(info.readBigUInt64LE()) as Pointer);
      win.CloseHandle(Number(info.readBigUInt64LE(8)) as Pointer);
    } finally {
      win.DeleteProcThreadAttributeList(attributes);
    }
  } catch (error) {
    win.CloseHandle(job);
    lib.close();
    throw error;
  }

  // Edge's launcher can exit after handing off to another process in the job.
  const accounting = Buffer.alloc(48); // JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
  function running() {
    if (
      !win.QueryInformationJobObject(
        job,
        1,
        accounting,
        accounting.length,
        null,
      )
    )
      throw failure("QueryInformationJobObject");
    return accounting.readUInt32LE(40) > 0; // ActiveProcesses
  }
  return {
    running,
    async close() {
      try {
        if (running() && !win.TerminateJobObject(job, 1))
          throw failure("TerminateJobObject");
        const deadline = performance.now() + 3_000;
        while (running()) {
          if (performance.now() >= deadline)
            throw new Error("Windows did not stop the fixture browser");
          await Bun.sleep(25);
        }
      } finally {
        win.CloseHandle(job);
        lib.close();
      }
    },
  };
}
