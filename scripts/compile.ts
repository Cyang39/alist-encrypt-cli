const tailwind = await import("bun-plugin-tailwind");

console.log("Building web...");

const result = await Bun.build({
  entrypoints: ["./src/web/index.html"],
  compile: true,
  target: "browser",
  outdir: "./dist",
  minify: true,
  plugins: [tailwind.default],
});

if (result.success) {
  console.log(`Web build successful`);
  console.log("Building cli...");

  const result = await Bun.build({
    entrypoints: ["./src/main.ts"],
    compile: true,
    target: "bun",
    minify: true,
    outdir: "./bin",
  });

  if (result.success) {
    console.log(`Cli build successful`);
  }
}
