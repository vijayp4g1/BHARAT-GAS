export interface GeminiOcrResult {
  consumerNumber: string;
  consumerName: string;
  found: boolean;
  error?: string;
}

/**
 * Resizes and compresses an image (File, Blob, or Data URL) on an HTML canvas
 * to a maximum dimension of 1000px and converts it to a compressed JPEG (70% quality).
 * This reduces network payload size by 90%+ and speeds up Gemini API response time.
 */
async function resizeAndCompressImage(
  imageSource: File | Blob | string,
  maxDimension: number = 1000
): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      // Maintain aspect ratio while resizing
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

      // Convert to compressed JPEG
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      const base64Data = dataUrl.split(',')[1];
      resolve({
        data: base64Data,
        mimeType: 'image/jpeg',
      });
    };

    img.onerror = (err) => {
      reject(err);
    };

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
 * Sends a receipt image to Google Gemini API to parse the consumer number and name
 */
export async function scanBillWithGemini(
  imageSource: File | Blob | string
): Promise<GeminiOcrResult> {
  const apiKey =
    import.meta.env.VITE_GEMINI_API_KEY ||
    localStorage.getItem('VITE_GEMINI_API_KEY');

  if (!apiKey) {
    return {
      consumerNumber: '',
      consumerName: '',
      found: false,
      error: 'API_KEY_MISSING',
    };
  }

  try {
    const compressed = await resizeAndCompressImage(imageSource);
    const imgPart = {
      inlineData: {
        data: compressed.data,
        mimeType: compressed.mimeType,
      },
    };

    // Call gemini-3.6-flash endpoint
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: "You are an expert OCR parser for LPG utility bills. Extract the Customer's unique Consumer Number (labeled as Cons No, Consumer No, Refill No, etc., usually 8 digits like 28721381) and the Customer's Name (e.g. PRAKASH). Respond ONLY with a clean JSON object matching this schema, without markdown formatting or backticks: {\"consumerNumber\": \"...\", \"consumerName\": \"...\"}. If not visible, leave empty.",
            },
            imgPart,
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errText}`);
    }

    const resData = await response.json();
    const responseText =
      resData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    const parsed = JSON.parse(responseText.trim());
    const consumerNumber = parsed.consumerNumber
      ? String(parsed.consumerNumber).trim()
      : '';
    const consumerName = parsed.consumerName
      ? String(parsed.consumerName).trim()
      : '';

    if (consumerNumber) {
      return {
        consumerNumber,
        consumerName,
        found: true,
      };
    }

    return {
      consumerNumber: '',
      consumerName: '',
      found: false,
    };
  } catch (err: any) {
    console.error('Gemini OCR scan failed:', err);
    return {
      consumerNumber: '',
      consumerName: '',
      found: false,
      error: err.message || 'Unknown error',
    };
  }
}

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
 * Uses Gemini 3.6 Flash AI to perform multi-agent spatial cluster dispatching
 */
export async function optimizeDispatchWithGemini(
  agents: { id: string; name: string }[],
  consumers: { id: string; consumer_name: string; consumer_number: string; address: string; cylinder_type?: string; latitude?: number; longitude?: number }[]
): Promise<GeminiDispatchResult> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || localStorage.getItem('VITE_GEMINI_API_KEY');

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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errText}`);
    }

    const resData = await response.json();
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
 * Uses Gemini 3.6 Flash AI to optimize turn-by-turn route ordering & provide landmark delivery advice
 */
export async function optimizeRouteWithGemini(
  agentPosition: { latitude: number; longitude: number } | null,
  stops: { id: string; consumer_id: string; consumer_name: string; address: string; cylinder_type?: string; landmark_notes?: string; latitude?: number; longitude?: number }[]
): Promise<GeminiRouteResult> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY || localStorage.getItem('VITE_GEMINI_API_KEY');

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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errText}`);
    }

    const resData = await response.json();
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
