import { NextResponse } from 'next/server';
import OpenAI from 'openai';

let openaiInstance = null;
function getOpenAI() {
  if (!openaiInstance) {
    openaiInstance = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiInstance;
}

const MAX_INPUT_LENGTH = 4096;

export async function POST(request) {
  try {
    const body = await request.json();
    const { text, voice = 'nova', speed = 1.0 } = body;

    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    const input = text.trim().slice(0, MAX_INPUT_LENGTH);

    const openai = getOpenAI();
    const response = await openai.audio.speech.create({
      model: 'tts-1',
      voice,
      input,
      speed,
      response_format: 'mp3',
    });

    const arrayBuffer = await response.arrayBuffer();

    return new Response(arrayBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(arrayBuffer.byteLength),
      },
    });
  } catch (err) {
    console.error('[TTS] Error:', err.message);
    return NextResponse.json(
      { error: 'TTS generation failed', details: err.message },
      { status: 500 }
    );
  }
}
