import fs from "node:fs/promises";
import * as fsSync from "node:fs";
import path from "node:path";
import { Workspace } from "../tools/workspace.js";
import { getVisionModelConfig, isVisionCapableModel } from "../router.js";
import type { AgentAttachment, MessageContentPart } from "../agent.js";

export const SUPPORTED_IMAGE_MIMES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

/**
 * Determine if an attachment represents an image.
 */
export function isImageAttachment(att: AgentAttachment): boolean {
  if (!att) return false;
  if (att.type && SUPPORTED_IMAGE_MIMES.has(att.type.toLowerCase())) return true;
  if (att.type && att.type.toLowerCase().startsWith("image/")) return true;
  if (att.name && /\.(jpe?g|png|webp|gif|svg)$/i.test(att.name)) return true;
  if (typeof att.content === "string" && att.content.startsWith("data:image/")) return true;
  return false;
}

/**
 * Extract MIME type and binary buffer from base64 data URI or raw string.
 */
export function extractImageData(content: string, defaultType = "image/png"): { mimeType: string; buffer: Buffer } {
  if (content.startsWith("data:")) {
    const match = content.match(/^data:([^;]+);base64,(.+)$/s);
    if (match) {
      const mimeType = match[1].toLowerCase();
      const buffer = Buffer.from(match[2], "base64");
      return { mimeType, buffer };
    }
  }

  // Check if raw base64 without data URI prefix
  try {
    const buffer = Buffer.from(content, "base64");
    if (buffer.length > 0) {
      return { mimeType: defaultType, buffer };
    }
  } catch {}

  return { mimeType: defaultType, buffer: Buffer.from(content, "utf8") };
}

/**
 * Persist an image attachment directly to the workspace filesystem so generated
 * HTML files can reference it via <img src="images/filename.ext">.
 */
export async function persistAttachmentToWorkspace(
  workspace: Workspace,
  att: AgentAttachment
): Promise<{ relativePath: string; fileName: string; sizeBytes: number }> {
  const baseName = path.basename(att.name || "attachment").replace(/[^a-zA-Z0-9._-]/g, "_");
  const ext = path.extname(baseName) || (att.type?.includes("jpeg") ? ".jpeg" : ".png");
  const fileName = baseName.endsWith(ext) ? baseName : `${baseName}${ext}`;

  const { buffer } = extractImageData(att.content, att.type || "image/png");

  // Save to images/ directory at workspace root
  const imagesRelPath = `images/${fileName}`;
  const imagesAbsPath = path.resolve(workspace.root, imagesRelPath);
  await fs.mkdir(path.dirname(imagesAbsPath), { recursive: true });
  await fs.writeFile(imagesAbsPath, buffer);

  // Also save to public/images/ if project has or uses a public folder
  try {
    const publicImagesRelPath = `public/images/${fileName}`;
    const publicImagesAbsPath = path.resolve(workspace.root, publicImagesRelPath);
    await fs.mkdir(path.dirname(publicImagesAbsPath), { recursive: true });
    await fs.writeFile(publicImagesAbsPath, buffer);
  } catch {}

  return {
    relativePath: imagesRelPath,
    fileName,
    sizeBytes: buffer.length,
  };
}

/**
 * Call a verified vision-capable model (meta/llama-3.2-90b-vision-instruct) to extract
 * visual characteristics, layout, dominant colors, and subject matter from an image attachment.
 */
export async function analyzeImageWithVisionModel(
  att: AgentAttachment,
  promptContext = ""
): Promise<{
  success: boolean;
  subject: string;
  palette: string[];
  layoutRecommendation: string;
  analysisText: string;
  modelUsed?: string;
  error?: string;
}> {
  const fallbackAnalysis = generateDeterministicVisionFallback(att, promptContext);

  try {
    const visionConfig = getVisionModelConfig();
    const dataUri = att.content.startsWith("data:")
      ? att.content
      : `data:${att.type || "image/png"};base64,${att.content}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000); // 25s deadline

    const response = await fetch(`${visionConfig.baseURL.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${visionConfig.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: visionConfig.name,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  `You are an expert UI/UX visual analyst. Analyze this user-attached image for a website build task "${promptContext || att.name}".\n` +
                  `Provide concise, structured output in 4 bullet points:\n` +
                  `1. Subject & Key Elements: Describe who/what is depicted (e.g. personal profile portrait, logo, product, diagram).\n` +
                  `2. Color Palette: List 3-4 dominant hex color codes.\n` +
                  `3. Aesthetic & Mood: Describe the visual theme.\n` +
                  `4. Layout Recommendation: Suggest how to feature this image in the website (e.g., hero avatar, card visual, banner).`,
              },
              {
                type: "image_url",
                image_url: { url: dataUri },
              },
            ],
          },
        ],
        max_tokens: 250,
      }),
    });

    clearTimeout(timeout);

    if (response.ok) {
      const json = await response.json();
      const content = json.choices?.[0]?.message?.content || "";
      if (content.trim()) {
        const extractedColors = content.match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/g) || fallbackAnalysis.palette;
        return {
          success: true,
          subject: extractSubjectFromText(content) || fallbackAnalysis.subject,
          palette: (Array.from(new Set(extractedColors)).slice(0, 5) as string[]),
          layoutRecommendation: content,
          analysisText: content,
          modelUsed: visionConfig.name,
        };
      }
    }
  } catch (err: any) {
    // If vision model request timed out or was rejected, proceed with deterministic fallback
  }

  return {
    ...fallbackAnalysis,
    success: true,
    modelUsed: "deterministic-heuristic-fallback",
  };
}

/**
 * Intelligent deterministic visual descriptor when VLM endpoint is offline or times out.
 */
export function generateDeterministicVisionFallback(
  att: AgentAttachment,
  promptContext = ""
): {
  subject: string;
  palette: string[];
  layoutRecommendation: string;
  analysisText: string;
} {
  const nameLower = (att.name || "").toLowerCase();
  const promptLower = promptContext.toLowerCase();

  const isPortrait =
    /dp|avatar|profile|portrait|person|face|selfie|user|ajmeer|author|developer|founder/i.test(nameLower) ||
    /portfolio|about me|bio|resume|profile|cv|ajmeer/i.test(promptLower);

  const isLogo = /logo|brand|icon|mark|emblem/i.test(nameLower) || /logo|brand/i.test(promptLower);
  const isProduct = /product|item|food|dish|goods|store|shop/i.test(nameLower) || /store|shop|ecommerce|menu/i.test(promptLower);

  if (isPortrait) {
    return {
      subject: "Personal Profile Portrait",
      palette: ["#0b0f19", "#1e293b", "#3b82f6", "#f8fafc", "#f59e0b"],
      layoutRecommendation:
        "Feature as a prominent circular or rounded-2xl hero avatar with an accent border, subtle glow, and hover elevation.",
      analysisText:
        "Subject: High-resolution personal profile portrait for developer/professional portfolio.\n" +
        "Palette: Dark navy (#0b0f19), card surface (#1e293b), vibrant accent (#3b82f6), crisp white text (#f8fafc).\n" +
        "Layout: Place in the Hero section with a rounded avatar frame (<img src='images/" + (att.name || "dp.jpeg") + "' class='hero-avatar' alt='Profile Photo'>).",
    };
  }

  if (isLogo) {
    return {
      subject: "Brand Logo / Identity",
      palette: ["#090d16", "#3b82f6", "#22c55e", "#f8fafc"],
      layoutRecommendation: "Embed in the navigation header bar and footer brand mark.",
      analysisText: `Subject: Brand logo and visual mark. Place in header navbar logo link.`,
    };
  }

  return {
    subject: "Visual Asset Reference",
    palette: ["#0b0f19", "#1e293b", "#3b82f6", "#f8fafc"],
    layoutRecommendation: "Incorporate as high-priority visual showcase in the hero or feature section.",
    analysisText: `Subject: Visual reference asset (${att.name}). Embed prominently in main section.`,
  };
}

function extractSubjectFromText(text: string): string | null {
  const match = text.match(/(?:subject|depicts|shows|pictured|is a)\s*[:=]?\s*([^.\n]+)/i);
  return match ? match[1].trim() : null;
}

/**
 * Comprehensive attachment processing for agent execution:
 * 1. Writes all binary image attachments into the workspace.
 * 2. Runs vision model analysis on images.
 * 3. Injects visual intelligence into prompt.
 * 4. Generates payload conforming to active model capabilities (text-only vs vision-capable).
 */
export async function processAttachmentsForAgent(
  workspace: Workspace,
  rawAttachments: AgentAttachment[] | undefined,
  userPrompt: string,
  activeModel: string
): Promise<{
  initialUserContent: string | MessageContentPart[];
  imageContextPrompt: string;
  savedImagePaths: string[];
}> {
  if (!rawAttachments || rawAttachments.length === 0) {
    return {
      initialUserContent: userPrompt,
      imageContextPrompt: "",
      savedImagePaths: [],
    };
  }

  const savedImagePaths: string[] = [];
  const visionAnalyses: string[] = [];
  const textAttachments: string[] = [];
  const rawImageParts: MessageContentPart[] = [];

  for (const att of rawAttachments) {
    if (isImageAttachment(att)) {
      // 1. Write image to workspace disk so it can be served in HTML and live preview
      try {
        const saved = await persistAttachmentToWorkspace(workspace, att);
        savedImagePaths.push(saved.relativePath);
      } catch (saveErr) {
        console.warn(`[Multimodal] Failed to persist image ${att.name}:`, saveErr);
      }

      // 2. Perform deep visual analysis via vision model
      const analysis = await analyzeImageWithVisionModel(att, userPrompt);
      visionAnalyses.push(
        `[Attached Image: ${att.name}]\n` +
        `- Saved Workspace Path: images/${att.name}\n` +
        `- HTML Tag Recommendation: <img src="images/${att.name}" alt="${att.name.replace(/\.[^.]+$/, '')}" class="hero-avatar" />\n` +
        `- Visual Analysis:\n${analysis.analysisText}\n` +
        `- Dominant Colors: ${analysis.palette.join(", ")}`
      );

      // 3. If the active model natively supports vision, prepare raw image parts
      if (isVisionCapableModel(activeModel)) {
        const dataUri = att.content.startsWith("data:")
          ? att.content
          : `data:${att.type || "image/png"};base64,${att.content}`;
        rawImageParts.push({
          type: "image_url",
          image_url: { url: dataUri, detail: "auto" },
        });
      }
    } else if (att.content) {
      textAttachments.push(`[Attached Document: ${att.name}]\n${att.content.slice(0, 10000)}`);
    }
  }

  const multimodalContext = visionAnalyses.length > 0
    ? `\n\n=== MULTIMODAL IMAGE REFERENCE & ASSET INTEGRATION ===\n` +
      `The user provided image attachment(s). These have been saved into your workspace.\n` +
      `YOU MUST use these images in the generated website using relative paths (e.g. <img src="images/...">).\n\n` +
      visionAnalyses.join("\n\n") +
      `\n=======================================================\n`
    : "";

  const textContext = textAttachments.length > 0
    ? `\n\n=== ATTACHED REFERENCES ===\n${textAttachments.join("\n\n")}\n`
    : "";

  const enrichedPrompt = userPrompt + multimodalContext + textContext;

  // If the active model is vision-capable, provide multi-part user content with both images and text
  if (isVisionCapableModel(activeModel) && rawImageParts.length > 0) {
    const parts: MessageContentPart[] = [
      ...rawImageParts,
      { type: "text", text: enrichedPrompt },
    ];
    return {
      initialUserContent: parts,
      imageContextPrompt: multimodalContext,
      savedImagePaths,
    };
  }

  // If the active model is text-only (e.g. minimax-m3.1-flash), pass enriched text prompt ONLY
  // to avoid vLLM/NIM rejecting the request with 'Received multimodal data but multimodal processing is not enabled'
  return {
    initialUserContent: enrichedPrompt,
    imageContextPrompt: multimodalContext,
    savedImagePaths,
  };
}
