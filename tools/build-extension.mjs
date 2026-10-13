import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JavaScriptObfuscator from "javascript-obfuscator";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "dist");
const excludedDirectories = new Set([".git", "node_modules", "dist", "debug", "license-server", "tools"]);
const excludedFiles = new Set([".gitignore", "BUILD.md", "package.json", "package-lock.json"]);

async function copyExtensionFiles(sourceDirectory, outputDirectory) {
    await mkdir(outputDirectory, { recursive: true });
    const entries = await readdir(sourceDirectory, { withFileTypes: true });

    for (const entry of entries) {
        if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;

        const sourcePath = path.join(sourceDirectory, entry.name);
        const outputPath = path.join(outputDirectory, entry.name);
        if (entry.isDirectory()) {
            await copyExtensionFiles(sourcePath, outputPath);
        } else if (
            entry.isFile() &&
            entry.name !== ".DS_Store" &&
            !/\.(?:crx|pem|zip)$/i.test(entry.name) &&
            !excludedFiles.has(entry.name)
        ) {
            await cp(sourcePath, outputPath);
        }
    }
}

async function obfuscateJavaScript(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        const filePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            await obfuscateJavaScript(filePath);
        } else if (entry.isFile() && entry.name.endsWith(".js")) {
            const source = await readFile(filePath, "utf8");
            const result = JavaScriptObfuscator.obfuscate(source, {
                compact: true,
                controlFlowFlattening: false,
                deadCodeInjection: false,
                debugProtection: false,
                identifierNamesGenerator: "hexadecimal",
                numbersToExpressions: false,
                renameGlobals: false,
                selfDefending: false,
                simplify: true,
                stringArray: true,
                stringArrayEncoding: ["base64"],
                stringArrayThreshold: 0.5,
                target: "browser-no-eval",
            });
            await writeFile(filePath, result.getObfuscatedCode(), "utf8");
        }
    }
}

await rm(outputRoot, { recursive: true, force: true });
await copyExtensionFiles(projectRoot, outputRoot);
await obfuscateJavaScript(outputRoot);
console.info(`Obfuscated extension build created at ${outputRoot}`);
