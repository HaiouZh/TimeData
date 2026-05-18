#!/usr/bin/env node
// 从根目录 icon.png 生成 PWA、Android、favicon 全套图标。
// 用法: node scripts/generate-icons.mjs

import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_PNG = resolve(ROOT, "icon.png");
const SRC_ICO = resolve(ROOT, "icon.ico");

const PWA_DIR = resolve(ROOT, "packages/client/public/icons");
const PUBLIC_DIR = resolve(ROOT, "packages/client/public");
const ANDROID_RES = resolve(ROOT, "packages/mobile/android/app/src/main/res");

// Android 自适应图标背景色，与 values/ic_launcher_background.xml 保持一致。
const ADAPTIVE_BG = "#FFFFFF";

// Android 启动图标各密度的尺寸（px）。
const ANDROID_DENSITIES = [
  { dir: "mipmap-mdpi", legacy: 48, foreground: 108 },
  { dir: "mipmap-hdpi", legacy: 72, foreground: 162 },
  { dir: "mipmap-xhdpi", legacy: 96, foreground: 216 },
  { dir: "mipmap-xxhdpi", legacy: 144, foreground: 324 },
  { dir: "mipmap-xxxhdpi", legacy: 192, foreground: 432 },
];

async function ensureDir(path) {
  await mkdir(path, { recursive: true });
}

// 直接缩放为方形 PNG（透明背景保留）。
async function resizePng(size, outPath) {
  await sharp(SRC_PNG).resize(size, size, { fit: "contain" }).png().toFile(outPath);
}

// 在指定边长画布上，把源图按 contentRatio 缩放居中，外圈用 background（或透明）填充。
// 用于 PWA maskable 和 Android adaptive foreground。
async function paddedPng({ size, contentRatio, background, outPath }) {
  const inner = Math.round(size * contentRatio);
  const resized = await sharp(SRC_PNG)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const canvas = sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });

  await canvas
    .composite([{ input: resized, gravity: "center" }])
    .png()
    .toFile(outPath);
}

async function generatePwa() {
  await ensureDir(PWA_DIR);
  // 普通图标：直接缩放，保留透明。
  await resizePng(192, resolve(PWA_DIR, "icon-192.png"));
  await resizePng(512, resolve(PWA_DIR, "icon-512.png"));
  // Maskable：内容收缩到 80%（safe zone），外圈白底，避免被 OS 裁切。
  await paddedPng({
    size: 192,
    contentRatio: 0.8,
    background: ADAPTIVE_BG,
    outPath: resolve(PWA_DIR, "icon-192-maskable.png"),
  });
  await paddedPng({
    size: 512,
    contentRatio: 0.8,
    background: ADAPTIVE_BG,
    outPath: resolve(PWA_DIR, "icon-512-maskable.png"),
  });
  console.log("[pwa] icons written to", PWA_DIR);
}

async function generateFavicon() {
  await ensureDir(PUBLIC_DIR);
  await resizePng(32, resolve(PUBLIC_DIR, "favicon-32.png"));
  await resizePng(16, resolve(PUBLIC_DIR, "favicon-16.png"));
  await copyFile(SRC_ICO, resolve(PUBLIC_DIR, "favicon.ico"));
  console.log("[favicon] written to", PUBLIC_DIR);
}

async function generateAndroid() {
  for (const { dir, legacy, foreground } of ANDROID_DENSITIES) {
    const targetDir = resolve(ANDROID_RES, dir);
    await ensureDir(targetDir);
    // 旧版方形图标（Android 8 以下）。
    await resizePng(legacy, resolve(targetDir, "ic_launcher.png"));
    // 旧版圆形图标。
    await resizePng(legacy, resolve(targetDir, "ic_launcher_round.png"));
    // 自适应图标前景：108dp 画布、内容 66dp 安全区 = 约 61%。
    await paddedPng({
      size: foreground,
      contentRatio: 66 / 108,
      background: null,
      outPath: resolve(targetDir, "ic_launcher_foreground.png"),
    });
  }
  console.log("[android] icons written to", ANDROID_RES);
}

async function main() {
  await generatePwa();
  await generateFavicon();
  await generateAndroid();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
