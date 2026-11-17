import { expect, test } from "bun:test";
import { MCP_APP_MAX_BYTES } from "../shared/mcp-app";
import { staticMcpApp } from "./mcp-app-static";

test("full HTML documents become static CSS/HTML/SVG fragments", async () => {
  const html = await staticMcpApp(`<!doctype html><html><head>
    <title>ignored</title><style>#chart{display:grid;color:red;padding:8px}</style>
    </head><body><svg id="chart" viewBox="0 0 100 100"><defs>
    <linearGradient id="paint"><stop offset="0" stop-color="red"/></linearGradient></defs>
    <rect width="80" height="50" fill="url(#paint)"/></svg>
    <p style="color:green;display:flex">Forecast</p></body></html>`);
  expect(html).toContain('<svg id="chart" viewBox="0 0 100 100">');
  expect(html).toContain('fill="url(#paint)"');
  expect(html).toContain('style="color:green;display:flex"');
  expect(html).not.toMatch(/<!doctype|<html|<head|<body|ignored/i);
});

test("scripts, navigation, forms, frames, images and remote assets are removed", async () => {
  const html = await staticMcpApp(`
    <meta http-equiv="refresh" content="0;url=https://evil.example">
    <base href="https://evil.example"><link rel="stylesheet" href="https://evil.example">
    <script>parent.rpc()</script><iframe srcdoc="<script>bad()</script>"></iframe>
    <object data="data:text/html,bad"></object><embed src="https://evil.example">
    <a href="javascript:parent.rpc()" target="_top">plain link</a>
    <form action="https://evil.example"><input><button>button text</button></form>
    <div onclick="bad()">Safe</div>
    <img src="data:image/png;base64,AAAA" onerror="bad()">
    <svg onload="bad()"><foreignObject><iframe></iframe></foreignObject>
      <use href="https://evil.example/a.svg#x"/><animate attributeName="href" values="javascript:bad()"/>
      <rect fill="url(https://evil.example)" style="fill:url(https://evil.example)"/>
    </svg><style>@import 'https://evil.example';@font-face{font-family:x;src:url(https://evil.example)}
      p{background-image:url('https://evil.example');color:red;animation:spin 1s}
    </style>`);
  expect(html).toContain("Safe");
  expect(html).toContain("plain link");
  expect(html).not.toMatch(
    /https:|javascript:|data:|onload|onclick|onerror|srcdoc|<script|<iframe|<meta|<base|<link|<form|<input|<button|<object|<embed|<img|<use|foreignObject|<animate|@import|@font-face|animation:/i,
  );
});

test("input bytes, depth, element count and CSS bytes are bounded", async () => {
  await expect(
    staticMcpApp("あ".repeat(Math.floor(MCP_APP_MAX_BYTES / 3) + 1)),
  ).rejects.toThrow("TOO_LARGE");
  await expect(
    staticMcpApp(`${"<div>".repeat(100)}x${"</div>".repeat(100)}`),
  ).rejects.toThrow("COMPLEX");
  await expect(staticMcpApp("<br>".repeat(5000))).rejects.toThrow("COMPLEX");
  await expect(
    staticMcpApp(`<style>${" ".repeat(129 * 1024)}</style>`),
  ).rejects.toThrow("COMPLEX");
});
