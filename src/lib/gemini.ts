export interface GeminiOcrResult {
  consumerNumber: string;
  consumerName: string;
  found: boolean;
  error?: string;
}

/* -------------------------------------------------------------------------- */
/*  Model & pricing configuration                                             */
/*                                                                            */
/*  OCR only needs vision + short JSON output, so there is no reason to pay   */
/*  for a "full" Flash/Pro model. Cheapest current vision-capable models      */
/*  (published per-1M-token prices, USD):                                     */
/*                                                                            */
/*    gemini-3.1-flash-lite ............ $0.25 input / $1.50 output (free tier)*/
/*    gemini-3.5-flash-lite ............ $0.30 input / $2.50 output (free tier)*/
/*                                                                            */
/*  Thinking is forced to "minimal"/off because OCR is not a reasoning task;  */
/*  thinking tokens are billed at the (expensive) output rate.                */
/*                                                                            */
/*  Override the primary scanner model from .env.local without touching code: */
/*      VITE_GEMINI_SCAN_MODEL=gemini-3.1-flash-lite                          */
/* -------------------------------------------------------------------------- */

export const CHEAP_SCAN_MODEL = 'gemini-3.1-flash-lite';
export const FALLBACK_SCAN_MODEL = 'gemini-3.5-flash-lite';

/** Model used for Smart Dispatch / Smart Route (was gemini-3.6-flash). */
export const CHEAP_AGENT_MODEL = 'gemini-3.5-flash-lite';

const MODEL_PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
};

export function getScanModelCandidates(): string[] {
  let override: string | null = null;
  try {
    override =
      (import.meta.env.VITE_GEMINI_SCAN_MODEL as string | undefined) ||
      localStorage.getItem('VITE_GEMINI_SCAN_MODEL');
  } catch (_) {
    override = (import.meta.env.VITE_GEMINI_SCAN_MODEL as string | undefined) || null;
  }
  return Array.from(new Set([override, CHEAP_SCAN_MODEL, FALLBACK_SCAN_MODEL].filter(Boolean))) as string[];
}

function getGeminiApiKey(): string | null {
  // Only VITE_-prefixed variables are inlined by Vite. A plain GEMINI_API_KEY
  // in Vercel is never visible to this code, so don't pretend to read it.
  return (
    (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ||
    localStorage.getItem('VITE_GEMINI_API_KEY') ||
    localStorage.getItem('GEMINI_API_KEY') ||
    null
  );
}

/** Logs actual token usage + estimated cost so spend is visible in the console. */
function logScanUsage(model: string, usage: any) {
  if (!usage) return;
  const inputTokens = Number(usage.promptTokenCount || 0);
  const outputTokens = Number(usage.candidatesTokenCount || 0);
  const thoughtTokens = Number(usage.thoughtsTokenCount || 0);
  const price = MODEL_PRICE_PER_MILLION[model];
  const cost = price
    ? (inputTokens * price.input + (outputTokens + thoughtTokens) * price.output) / 1_000_000
    : null;

  console.log(
    `[AI Scanner] ${model} · in ${inputTokens} / out ${outputTokens}${thoughtTokens ? ` / think ${thoughtTokens}` : ''} tokens` +
      (cost !== null ? ` · ≈ $${cost.toFixed(6)}` : '')
  );
}

/* -------------------------------------------------------------------------- */
/*  Image helpers                                                             */
/* -------------------------------------------------------------------------- */

interface PreprocessOptions {
  maxDimension?: number;
  quality?: number;
  grayscale?: boolean;
  contrast?: number;
}

/**
 * Resizes / compresses an image and optionally applies grayscale + contrast
 * boost (useful for faint dot-matrix receipts). Returns base64 + mime type.
 */
async function preprocessImage(
  imageSource: File | Blob | string,
  options: PreprocessOptions = {}
): Promise<{ data: string; mimeType: string }> {
  const { maxDimension = 1280, quality = 0.8, grayscale = false, contrast = 1 } = options;

  // Already a base64 data URL and no pixel processing requested → use as-is.
  if (
    !grayscale &&
    contrast === 1 &&
    typeof imageSource === 'string' &&
    imageSource.startsWith('data:image/')
  ) {
    const [header, base64Data] = imageSource.split(',');
    const mimeMatch = header.match(/data:(.*?);base64/);
    return {
      data: base64Data,
      mimeType: mimeMatch ? mimeMatch[1] : 'image/jpeg',
    };
  }

  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      // Maintain aspect ratio while resizing (fewer pixels = fewer image tokens)
      if (width > height) {
        if (width > maxDimension) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        }
      } else {
        if (height > maxDimension) {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas 2D context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      if (grayscale || contrast !== 1) {
        try {
          const frame = ctx.getImageData(0, 0, width, height);
          const pixels = frame.data;
          for (let i = 0; i < pixels.length; i += 4) {
            // Luminance
            let v = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
            // Contrast around mid-gray
            v = (v - 128) * contrast + 128;
            v = v < 0 ? 0 : v > 255 ? 255 : v;
            pixels[i] = v;
            pixels[i + 1] = v;
            pixels[i + 2] = v;
          }
          ctx.putImageData(frame, 0, 0);
        } catch (_) {
          // getImageData can fail on tainted canvases — fall back to colour JPEG.
        }
      }

      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve({ data: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
    };

    img.onerror = (err) => reject(err);

    if (typeof imageSource === 'string') {
      img.src = imageSource;
    } else {
      const reader = new FileReader();
      reader.onloadend = () => {
        img.src = reader.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(imageSource);
    }
  });
}

/**
 * Produces a high-contrast grayscale version of a receipt image.
 * Dot-matrix bills often have faint, broken digits; the enhanced copy is
 * re-read only when the first OCR pass cannot be verified in the database.
 */
export async function enhanceImageForOcr(
  imageSource: File | Blob | string
): Promise<string | null> {
  try {
    const { data, mimeType } = await preprocessImage(imageSource, {
      maxDimension: 1600,
      quality: 0.9,
      grayscale: true,
      contrast: 1.7,
    });
    return `data:${mimeType};base64,${data}`;
  } catch (err) {
    console.warn('[AI Scanner] Image enhancement failed:', err);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  Duplicate-call cache (accidental double taps / repeated retries)          */
/* -------------------------------------------------------------------------- */

const SCAN_CACHE_TTL_MS = 45_000;
const SCAN_CACHE_MAX = 25;
const scanResultCache = new Map<string, { at: number; result: GeminiOcrResult }>();

function fingerprintImage(base64: string): string {
  // Cheap FNV-1a over a sample of the payload — collision risk is negligible
  // for exact-same-frame detection and this avoids hashing ~100KB per scan.
  let hash = 2166136261;
  for (let i = 0; i < base64.length; i += 97) {
    hash ^= base64.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${base64.length}:${hash >>> 0}`;
}

function readCachedScan(key: string): GeminiOcrResult | null {
  const hit = scanResultCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > SCAN_CACHE_TTL_MS) {
    scanResultCache.delete(key);
    return null;
  }
  return hit.result;
}

function writeCachedScan(key: string, result: GeminiOcrResult) {
  if (result.error) return; // never cache transient failures
  scanResultCache.set(key, { at: Date.now(), result });
  while (scanResultCache.size > SCAN_CACHE_MAX) {
    const oldest = scanResultCache.keys().next().value;
    if (oldest === undefined) break;
    scanResultCache.delete(oldest);
  }
}

/* -------------------------------------------------------------------------- */
/*  Bill OCR                                                                  */
/* -------------------------------------------------------------------------- */

const SCAN_PROMPT = `You are a high-accuracy OCR assistant for Indian Bharatgas (BPCL) LPG delivery receipts and cash memos.
The picture is a tight crop of the receiver line and may contain only the "Cons No" / "Name" fields.
Carefully examine the receipt image:
1. "consumerNumber": The consumer number printed next to or under "Cons No:", "Consumer No:", or "Cons. No."
   CRITICAL DOT-MATRIX PRINT INSTRUCTIONS:
   - Dot-matrix printers often print digits with faint or separated pin dots.
   - Pay extreme attention to distinguishing '8' vs '6' vs '0':
     * An '8' has BOTH upper and lower closed circular loops with a middle cross-bar.
     * A '6' has an open upper-right stem and only ONE bottom loop.
     * A '0' is a single hollow oval with NO middle cross-bar.
     * If the digit has a middle horizontal cross-bar or two stacked loops, it is strictly an '8' (eight), NOT a '6' or '0'.
   - Read the exact printed digits one by one. Never merge digits from the label, date, amount or a neighbouring field.
   - Never invent digits. If the number is genuinely unreadable, return an empty string.
2. "consumerName": The customer's full name printed next to "Name:" under "Details of Receiver:" or directly under "Cons No:".
   - Copy the spelling exactly as printed. If unreadable, return an empty string.
3. Strictly ignore:
   - Distributor code (e.g. 169624)
   - Telephone/mobile numbers (e.g. 1800..., 7718..., or 10 digits starting with 6-9)
   - Date, time, cash memo/voucher numbers, or amounts.

Return ONLY a valid JSON object matching this schema:
{"consumerNumber": "<exact_digits>", "consumerName": "<exact_customer_name>"}`;

/**
 * Sends a receipt image to Google Gemini API to parse the consumer number and name.
 * Uses the cheapest vision-capable model and forces minimal thinking to keep
 * per-scan cost to a fraction of a cent.
 */
export async function scanBillWithGemini(
  imageSource: File | Blob | string
): Promise<GeminiOcrResult> {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    return {
      consumerNumber: '',
      consumerName: '',
      found: false,
      error: 'API_KEY_MISSING',
    };
  }

  try {
    const compressed = await preprocessImage(imageSource);
    const cacheKey = fingerprintImage(compressed.data);
    const cached = readCachedScan(cacheKey);
    if (cached) return cached;

    const imgPart = {
      inlineData: {
        data: compressed.data,
        mimeType: compressed.mimeType,
      },
    };

    const buildRequestBody = (thinking: 'level' | 'none') => {
      const generationConfig: Record<string, unknown> = {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            consumerNumber: { type: 'STRING' },
            consumerName: { type: 'STRING' },
          },
          required: ['consumerNumber', 'consumerName'],
        },
        maxOutputTokens: 64,
        temperature: 0,
      };

      if (thinking === 'level') {
        // Gemini 3.x: "minimal" keeps thinking (and its output-priced tokens) near zero.
        generationConfig.thinkingConfig = { thinkingLevel: 'minimal' };
      }

      return {
        contents: [{ parts: [{ text: SCAN_PROMPT }, imgPart] }],
        generationConfig,
      };
    };

    // Try the cheapest model first. For each model we attempt the modern
    // thinkingLevel parameter, then retry without it for older model versions.
    const attempts: Array<{ model: string; thinking: 'level' | 'none' }> = [];
    for (const model of getScanModelCandidates()) {
      attempts.push({ model, thinking: 'level' });
      attempts.push({ model, thinking: 'none' });
    }

    let response: Response | null = null;
    let usedModel = '';
    let lastError = '';
    let failedModel = '';
    let failedStatus = 0;

    for (const attempt of attempts) {
      // Only drop thinkingConfig when the API rejected the request shape
      // (400/404/415/422). Retrying the same model after a 429/5xx/network
      // failure just doubles the wait, so move straight to the next model.
      if (
        attempt.thinking === 'none' &&
        attempt.model === failedModel &&
        failedStatus !== 0 &&
        ![400, 404, 415, 422].includes(failedStatus)
      ) {
        continue;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20_000);
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${attempt.model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildRequestBody(attempt.thinking)),
            signal: controller.signal,
          }
        );

        if (res.ok) {
          response = res;
          usedModel = attempt.model;
          break;
        }

        const errText = await res.text();
        lastError = `${res.status} - ${errText}`;
        failedModel = attempt.model;
        failedStatus = res.status;

        // Stop hammering the API if the key itself is rejected.
        if (
          res.status === 401 ||
          res.status === 403 ||
          /API_KEY_INVALID|API key not valid|PERMISSION_DENIED/i.test(errText)
        ) {
          break;
        }
      } catch (networkErr: any) {
        lastError =
          networkErr?.name === 'AbortError'
            ? 'request timed out'
            : networkErr?.message || 'network error';
        failedModel = attempt.model;
        failedStatus = -1;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (!response) {
      // Turn raw provider JSON into an actionable message for rotated/invalid keys.
      if (/^(401|403)\b|API_KEY_INVALID|API key not valid|API key expired|PERMISSION_DENIED/i.test(lastError)) {
        throw new Error('AI key rejected — update VITE_GEMINI_API_KEY and redeploy');
      }
      throw new Error(`Gemini API error: ${lastError}`);
    }

    const resData = await response.json();
    logScanUsage(usedModel, resData.usageMetadata);

    const responseText =
      resData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    let consumerNumber = '';
    let consumerName = '';

    try {
      const cleanJsonStr = responseText
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
      const parsed = JSON.parse(cleanJsonStr);
      consumerNumber = parsed.consumerNumber ? String(parsed.consumerNumber).trim() : '';
      consumerName = parsed.consumerName ? String(parsed.consumerName).trim() : '';
    } catch (parseErr) {
      console.warn('JSON parse fallback active for Gemini output:', responseText);
      const numMatch = responseText.match(/Cons\s*No\s*:?\s*(\d{1,12})/i) || responseText.match(/\b\d{1,12}\b/);
      if (numMatch) {
        consumerNumber = numMatch[1] || numMatch[0];
      }
      const nameMatch = responseText.match(/"consumerName"\s*:\s*"([^"]+)"/i);
      if (nameMatch) {
        consumerName = nameMatch[1];
      }
    }

    const result: GeminiOcrResult = consumerNumber
      ? { consumerNumber, consumerName, found: true }
      : { consumerNumber: '', consumerName: '', found: false };

    writeCachedScan(cacheKey, result);
    return result;
  } catch (err: any) {
    console.error('Gemini OCR scan failed:', err);
    return {
      consumerNumber: '',
      consumerName: '',
      found: false,
      error: err.message?.includes('JSON') ? undefined : err.message,
    };
  }
}

/* -------------------------------------------------------------------------- */
/*  Smart dispatch / route (kept on a cheap Flash-Lite model)                  */
/* -------------------------------------------------------------------------- */

export interface GeminiDispatchAssignment {
  agentId: string;
  agentName: string;
  consumerIds: string[];
  rationale: string;
}

export interface GeminiDispatchResult {
  assignments: GeminiDispatchAssignment[];
  overallSummary: string;
  error?: string;
}

/**
 * Uses a cheap Gemini Flash-Lite model to perform multi-agent spatial cluster dispatching
 */
export async function optimizeDispatchWithGemini(
  agents: { id: string; name: string }[],
  consumers: { id: string; consumer_name: string; consumer_number: string; address: string; cylinder_type?: string; latitude?: number; longitude?: number }[]
): Promise<GeminiDispatchResult> {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    return { assignments: [], overallSummary: '', error: 'API_KEY_MISSING' };
  }

  if (agents.length === 0 || consumers.length === 0) {
    return { assignments: [], overallSummary: 'No agents or consumers to dispatch.' };
  }

  try {
    const prompt = `You are an expert AI logistics and dispatch manager for an LPG cylinder distribution agency.
Assign the following consumers to the available delivery agents to minimize total delivery distance, balance agent workloads, and prioritize 10kg Lite Composite cylinder orders ('10KG_LITE').

Available Agents:
${JSON.stringify(agents, null, 2)}

Pending Consumer Deliveries:
${JSON.stringify(consumers.map(c => ({
  id: c.id,
  name: c.consumer_name,
  number: c.consumer_number,
  address: c.address,
  cylinderType: c.cylinder_type || '14.2KG_STD',
  lat: c.latitude || null,
  lng: c.longitude || null
})), null, 2)}

Respond ONLY with a valid JSON object matching this schema, without markdown formatting or backticks:
{
  "assignments": [
    {
      "agentId": "agent_uuid",
      "agentName": "Agent Name",
      "consumerIds": ["consumer_uuid_1", "consumer_uuid_2"],
      "rationale": "Reason for assignment..."
    }
  ],
  "overallSummary": "Brief overall summary of AI dispatch rationale"
}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${CHEAP_AGENT_MODEL}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingLevel: 'minimal' },
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errText}`);
    }

    const resData = await response.json();
    logScanUsage(CHEAP_AGENT_MODEL, resData.usageMetadata);
    const responseText = resData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = JSON.parse(responseText.trim());

    return {
      assignments: parsed.assignments || [],
      overallSummary: parsed.overallSummary || 'AI dispatch completed successfully.'
    };
  } catch (err: any) {
    console.error('Gemini Smart Dispatch failed:', err);
    return { assignments: [], overallSummary: '', error: err.message || 'Unknown AI error' };
  }
}

export interface GeminiRouteStopAdvice {
  consumerId: string;
  stopSequence: number;
  aiAdvice: string;
}

export interface GeminiRouteResult {
  optimizedOrder: string[];
  stopAdvice: GeminiRouteStopAdvice[];
  aiOverview: string;
  error?: string;
}

/**
 * Uses a cheap Gemini Flash-Lite model to optimize route ordering & provide landmark delivery advice
 */
export async function optimizeRouteWithGemini(
  agentPosition: { latitude: number; longitude: number } | null,
  stops: { id: string; consumer_id: string; consumer_name: string; address: string; cylinder_type?: string; landmark_notes?: string; latitude?: number; longitude?: number }[]
): Promise<GeminiRouteResult> {
  const apiKey = getGeminiApiKey();

  if (!apiKey) {
    return { optimizedOrder: stops.map(s => s.consumer_id), stopAdvice: [], aiOverview: '', error: 'API_KEY_MISSING' };
  }

  if (stops.length === 0) {
    return { optimizedOrder: [], stopAdvice: [], aiOverview: 'No stops in route.' };
  }

  try {
    const prompt = `You are an expert AI route planner for an LPG delivery agent.
Optimize the route sequence starting from the agent's current position to minimize travel distance. Give highest priority to '10KG_LITE' composite cylinder deliveries. For each stop, provide a short, actionable delivery advice tip (e.g., parking tip, landmark note, building accessibility).

Agent Current Location:
${agentPosition ? JSON.stringify(agentPosition) : 'Location unavailable (use spatial geographic clustering)'}

Stops to Route:
${JSON.stringify(stops.map(s => ({
  consumerId: s.consumer_id,
  name: s.consumer_name,
  address: s.address,
  cylinderType: s.cylinder_type || '14.2KG_STD',
  landmarkNotes: s.landmark_notes || '',
  lat: s.latitude || null,
  lng: s.longitude || null
})), null, 2)}

Respond ONLY with a valid JSON object matching this schema, without markdown formatting or backticks:
{
  "optimizedOrder": ["consumer_id_1", "consumer_id_2"],
  "stopAdvice": [
    {
      "consumerId": "consumer_id_1",
      "stopSequence": 1,
      "aiAdvice": "Short delivery advice tip..."
    }
  ],
  "aiOverview": "Brief overview of AI route optimization"
}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${CHEAP_AGENT_MODEL}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingLevel: 'minimal' },
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errText}`);
    }

    const resData = await response.json();
    logScanUsage(CHEAP_AGENT_MODEL, resData.usageMetadata);
    const responseText = resData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = JSON.parse(responseText.trim());

    return {
      optimizedOrder: parsed.optimizedOrder || stops.map(s => s.consumer_id),
      stopAdvice: parsed.stopAdvice || [],
      aiOverview: parsed.aiOverview || 'AI Smart Route generated successfully.'
    };
  } catch (err: any) {
    console.error('Gemini Smart Route failed:', err);
    return {
      optimizedOrder: stops.map(s => s.consumer_id),
      stopAdvice: [],
      aiOverview: '',
      error: err.message || 'Unknown AI error'
    };
  }
}
