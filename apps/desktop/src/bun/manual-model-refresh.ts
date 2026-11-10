export async function manualModelRefresh(
  provider: string,
  options: {
    hasProvider: (provider: string) => boolean;
    online: boolean;
    refresh: (options: {
      providers: string[];
      allowNetwork: true;
      force: true;
    }) => Promise<{ errors: ReadonlyMap<string, Error> }[]>;
  },
) {
  if (typeof provider !== "string" || !options.hasProvider(provider))
    throw new Error("Invalid provider.");
  if (!options.online)
    throw new Error("Model refresh is unavailable in offline mode.");
  const results = await options.refresh({
    providers: [provider],
    allowNetwork: true,
    force: true,
  });
  for (const result of results) {
    const error = result.errors.get(provider);
    if (error) throw new Error(`Model catalog ${provider}: ${error.message}`);
  }
}
