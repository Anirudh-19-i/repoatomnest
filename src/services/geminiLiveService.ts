import { GoogleGenAI, Modality, LiveServerMessage, Type, ThinkingLevel } from "@google/genai";

export class GeminiLiveService {
  private ai: GoogleGenAI;
  private session: any; // Using any for session as types are complex
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private audioQueue: Int16Array[] = [];
  private isPlaying = false;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  async connect(callbacks: {
    onMessage?: (text: string) => void;
    onResponseStarted?: () => void;
    onInterrupted?: () => void;
    onToolCall?: (toolCall: any) => Promise<any>;
    onUserSpeaking?: (isSpeaking: boolean) => void;
  }) {
    this.audioContext = new AudioContext({ sampleRate: 24000 });
    
    this.session = await this.ai.live.connect({
      model: "gemini-2.5-flash-native-audio-preview-09-2025",
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
        },
        systemInstruction: "You are an AI Shopping Assistant. You are MULTILINGUAL: always respond in the language the user speaks to you. VOICE: Speak clearly and concisely. PRIVACY: You are dedicated to visually impaired users. NEVER repeat full card numbers, CVVs, or sensitive personal data out loud. Only use last 4 digits for confirmation. BIOMETRICS: This app uses Voice ID and Face ID for payment authorization. Only the registered user's voice and face can authorize payments. When a user wants to place an order, tell them biometric authorization is starting. Once they have looked at the camera and said 'Authorize', call 'confirmBiometricAuth' to complete the payment. WAKE WORD: Only start the conversation or respond to requests if you hear the phrase 'Hello' or if a conversation is already active. AUTO-STOP: If the user indicates they are finished, satisfied, or says goodbye, call the 'stopConversation' tool immediately to end the session. TOOLS: You have a 'togglePrivacyShield' tool to hide the screen for the user's security.",
        tools: [{
          functionDeclarations: [
            {
              name: "stopConversation",
              parameters: { type: Type.OBJECT, properties: {} }
            },
            {
              name: "togglePrivacyShield",
              parameters: { type: Type.OBJECT, properties: {} }
            },
            {
              name: "confirmBiometricAuth",
              parameters: { type: Type.OBJECT, properties: {} }
            },
            {
              name: "searchProducts",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  query: { type: Type.STRING, description: "The search query for products" }
                },
                required: ["query"]
              }
            },
            {
              name: "addToCart",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  productId: { type: Type.STRING, description: "The ID of the product to add" },
                  productName: { type: Type.STRING, description: "The name of the product to add (use if ID is unknown)" },
                  quantity: { type: Type.NUMBER, description: "The quantity to add" }
                },
                required: ["quantity"]
              }
            },
            {
              name: "getCart",
              parameters: { type: Type.OBJECT, properties: {} }
            },
            {
              name: "placeOrder",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  paymentMethod: { type: Type.STRING, description: "The payment method (e.g., UPI, Stripe, Paytm, or 'saved')" }
                },
                required: ["paymentMethod"]
              }
            },
            {
              name: "savePaymentMethod",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, enum: ["card", "upi", "wallet"], description: "Type of payment method" },
                  provider: { type: Type.STRING, description: "Provider name (e.g., Visa, Mastercard, Google Pay)" },
                  last4: { type: Type.STRING, description: "Last 4 digits (for cards)" }
                },
                required: ["type", "provider"]
              }
            },
            {
              name: "getPaymentMethods",
              parameters: { type: Type.OBJECT, properties: {} }
            },
            {
              name: "trackOrder",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  orderId: { type: Type.STRING, description: "The ID of the order to track" }
                },
                required: ["orderId"]
              }
            },
            {
              name: "cancelOrder",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  orderId: { type: Type.STRING, description: "The ID of the order to cancel" }
                },
                required: ["orderId"]
              }
            }
          ]
        }]
      },
      callbacks: {
        onopen: () => {
          this.startMic(callbacks.onUserSpeaking);
        },
        onmessage: async (message: LiveServerMessage) => {
          if (message.serverContent?.modelTurn?.parts) {
            callbacks.onResponseStarted?.();
            for (const part of message.serverContent.modelTurn.parts) {
              if (part.inlineData) {
                const base64Data = part.inlineData.data;
                const binaryString = atob(base64Data);
                const bytes = new Int16Array(binaryString.length / 2);
                for (let i = 0; i < bytes.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i * 2) | (binaryString.charCodeAt(i * 2 + 1) << 8);
                }
                this.audioQueue.push(bytes);
                if (!this.isPlaying) this.playNext();
              }
              if (part.text) {
                callbacks.onMessage?.(part.text);
              }
            }
          }

          if (message.toolCall) {
            const responses = [];
            for (const call of message.toolCall.functionCalls) {
              const result = await callbacks.onToolCall?.(call);
              responses.push({
                name: call.name,
                response: result,
                id: call.id
              });
            }
            this.session.sendToolResponse({ functionResponses: responses });
          }

          if (message.serverContent?.interrupted) {
            this.audioQueue = [];
            this.isPlaying = false;
            callbacks.onInterrupted?.();
          }
        }
      }
    });
  }

  private async startMic(onUserSpeaking?: (isSpeaking: boolean) => void) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.source = this.audioContext!.createMediaStreamSource(stream);
    this.processor = this.audioContext!.createScriptProcessor(2048, 1, 1);

    let silenceCounter = 0;
    const SILENCE_THRESHOLD = 0.01;
    const SILENCE_LIMIT = 6; // roughly 0.5s at 2048 buffer size

    this.processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      let sum = 0;
      const pcmData = new Int16Array(inputData.length);
      for (let i = 0; i < inputData.length; i++) {
        const val = inputData[i];
        sum += val * val;
        pcmData[i] = Math.max(-1, Math.min(1, val)) * 0x7FFF;
      }
      
      const rms = Math.sqrt(sum / inputData.length);
      if (rms > SILENCE_THRESHOLD) {
        silenceCounter = 0;
        onUserSpeaking?.(true);
      } else {
        silenceCounter++;
        if (silenceCounter > SILENCE_LIMIT) {
          onUserSpeaking?.(false);
        }
      }

      const base64Data = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
      this.session.sendRealtimeInput({
        media: { data: base64Data, mimeType: "audio/pcm;rate=24000" }
      });
    };

    this.source.connect(this.processor);
    this.processor.connect(this.audioContext!.destination);
  }

  private playNext() {
    if (this.audioQueue.length === 0) {
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;
    const pcmData = this.audioQueue.shift()!;
    const buffer = this.audioContext!.createBuffer(1, pcmData.length, 24000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < pcmData.length; i++) {
      channelData[i] = pcmData[i] / 0x7FFF;
    }

    const source = this.audioContext!.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext!.destination);
    source.onended = () => this.playNext();
    source.start();
  }

  disconnect() {
    this.session?.close();
    this.source?.disconnect();
    this.processor?.disconnect();
    this.audioContext?.close();
  }
}
