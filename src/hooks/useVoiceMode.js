'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

const SILENCE_TIMEOUT_MS = 2000;
const MIN_CONFIDENCE = 0.65;
const MIN_TRANSCRIPT_LENGTH = 3;

export function useVoiceMode({ onSend, onResponse, onNavigation, ttsVoice = 'nova' }) {
  const [voiceModeActive, setVoiceModeActive] = useState(false);
  const [voiceState, setVoiceState] = useState('idle'); // idle | listening | processing | speaking
  const [transcript, setTranscript] = useState('');
  const [lastResponseText, setLastResponseText] = useState('');
  const [error, setError] = useState(null);

  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);
  const activeRef = useRef(false); // mirrors voiceModeActive without stale closure issues
  const stateRef = useRef('idle');

  // Keep refs in sync
  useEffect(() => { activeRef.current = voiceModeActive; }, [voiceModeActive]);
  useEffect(() => { stateRef.current = voiceState; }, [voiceState]);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const stopAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  const stopRecognition = useCallback(() => {
    clearSilenceTimer();
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
      recognitionRef.current = null;
    }
  }, [clearSilenceTimer]);

  const startRecognition = useCallback(() => {
    if (!activeRef.current) return;

    const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SR) {
      setError('browser-unsupported');
      return;
    }

    // Clean up any existing instance
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch {}
    }

    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = 'en-US';

    let finalTranscript = '';

    r.onresult = (e) => {
      clearSilenceTimer();
      let interim = '';
      finalTranscript = '';
      for (let i = 0; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          // Only accept high-confidence results to filter noise
          if (result[0].confidence >= MIN_CONFIDENCE) {
            finalTranscript += result[0].transcript;
          }
        } else {
          interim += result[0].transcript;
        }
      }
      setTranscript(finalTranscript + interim);

      // If we have a final result with enough substance, start silence timer
      if (finalTranscript.trim().length >= MIN_TRANSCRIPT_LENGTH) {
        silenceTimerRef.current = setTimeout(() => {
          if (!activeRef.current) return;
          const text = finalTranscript.trim();
          if (text.length >= MIN_TRANSCRIPT_LENGTH) {
            stopRecognition();
            handleUtterance(text);
          }
        }, SILENCE_TIMEOUT_MS);
      }
    };

    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setError('no-mic-permission');
        setVoiceModeActive(false);
        activeRef.current = false;
        setVoiceState('idle');
        return;
      }
      // no-speech or aborted — auto-restart if still active
      if (activeRef.current && stateRef.current === 'listening') {
        setTimeout(() => startRecognition(), 300);
      }
    };

    r.onend = () => {
      // Chrome stops continuous recognition after ~60s. Auto-restart.
      if (activeRef.current && stateRef.current === 'listening') {
        setTimeout(() => startRecognition(), 300);
      }
    };

    recognitionRef.current = r;
    try {
      r.start();
      setVoiceState('listening');
      setTranscript('');
      setLastResponseText('');
    } catch (err) {
      console.error('[VoiceMode] Recognition start failed:', err);
      if (activeRef.current) {
        setTimeout(() => startRecognition(), 500);
      }
    }
  }, [clearSilenceTimer, stopRecognition]);

  const handleUtterance = useCallback(async (text) => {
    setVoiceState('processing');
    setTranscript(text);

    try {
      // Send to AI analyst
      const response = await onSend(text);
      if (!activeRef.current) return;

      // Execute navigation commands
      if (response?.navigation && onNavigation) {
        onNavigation(response.navigation);
      }

      // Notify caller of response
      if (onResponse) {
        onResponse({ userText: text, ...response });
      }

      // Play TTS
      const spokenText = response?.spokenText || response?.answer;
      if (spokenText && activeRef.current) {
        setLastResponseText(spokenText);
        await playTTS(spokenText);
      } else if (activeRef.current) {
        // No text to speak, go back to listening
        startRecognition();
      }
    } catch (err) {
      console.error('[VoiceMode] Processing error:', err);
      if (activeRef.current) {
        // Try to speak an error message, fallback to browser TTS
        speakFallback('Sorry, I encountered an error. Please try again.');
      }
    }
  }, [onSend, onResponse, onNavigation, startRecognition]);

  const playTTS = useCallback(async (text) => {
    if (!activeRef.current) return;
    setVoiceState('speaking');

    // Kill any browser TTS that might be playing
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: ttsVoice }),
      });

      if (!res.ok) throw new Error(`TTS API returned ${res.status}`);
      if (!activeRef.current) return;

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;

      // Barge-through: listen during playback so user can interrupt by speaking
      const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
      let bargeRecognition = null;
      let bargeTriggered = false;

      const cleanupBarge = () => {
        if (bargeRecognition) {
          try { bargeRecognition.abort(); } catch {}
          bargeRecognition = null;
        }
      };

      if (SR) {
        try {
          bargeRecognition = new SR();
          bargeRecognition.continuous = true;
          bargeRecognition.interimResults = true;
          bargeRecognition.lang = 'en-US';

          bargeRecognition.onresult = (e) => {
            if (bargeTriggered) return;
            for (let i = e.resultIndex; i < e.results.length; i++) {
              const transcript = e.results[i][0]?.transcript?.trim();
              const confidence = e.results[i][0]?.confidence || 0;
              const isFinal = e.results[i].isFinal;

              // For barge: require final result with good confidence and real words
              // This prevents background noise from triggering interrupts
              if (isFinal && transcript && transcript.length >= MIN_TRANSCRIPT_LENGTH && confidence >= MIN_CONFIDENCE) {
                bargeTriggered = true;
                console.log('[VoiceMode] Barge-through:', transcript, 'confidence:', confidence.toFixed(2));

                audio.pause();
                cleanupBarge();
                stopAudio();
                handleUtterance(transcript);
                return;
              }
            }
          };

          bargeRecognition.onerror = (e) => {
            // no-speech is normal — user hasn't spoken yet
            if (e.error !== 'no-speech' && e.error !== 'aborted') {
              console.warn('[VoiceMode] Barge recognition error:', e.error);
            }
          };

          bargeRecognition.onend = () => {
            // Auto-restart barge listener if audio is still playing and we haven't barged
            if (!bargeTriggered && audioRef.current && !audioRef.current.paused && activeRef.current) {
              try { bargeRecognition?.start(); } catch {}
            }
          };

          bargeRecognition.start();
        } catch (e) {
          console.warn('[VoiceMode] Could not start barge listener:', e);
          bargeRecognition = null;
        }
      }

      audio.onended = () => {
        cleanupBarge();
        stopAudio();
        if (activeRef.current && !bargeTriggered) {
          startRecognition();
        }
      };

      audio.onerror = () => {
        cleanupBarge();
        console.warn('[VoiceMode] Audio playback failed, falling back to browser TTS');
        stopAudio();
        speakFallback(text);
      };

      await audio.play();
    } catch (err) {
      console.warn('[VoiceMode] TTS fetch failed, using browser fallback:', err.message);
      stopAudio();
      speakFallback(text);
    }
  }, [ttsVoice, stopAudio, startRecognition]);

  const speakFallback = useCallback((text) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      // No fallback available, just go back to listening
      if (activeRef.current) startRecognition();
      return;
    }

    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    u.pitch = 1.0;
    u.onend = () => {
      if (activeRef.current) startRecognition();
    };
    u.onerror = () => {
      if (activeRef.current) startRecognition();
    };
    setVoiceState('speaking');
    window.speechSynthesis.speak(u);
  }, [startRecognition]);

  const toggleVoiceMode = useCallback(() => {
    if (voiceModeActive) {
      // Deactivate
      activeRef.current = false;
      setVoiceModeActive(false);
      stopRecognition();
      stopAudio();
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      setVoiceState('idle');
      setTranscript('');
      setError(null);
    } else {
      // Activate
      setError(null);
      setVoiceModeActive(true);
      activeRef.current = true;
      startRecognition();
    }
  }, [voiceModeActive, stopRecognition, stopAudio, startRecognition]);

  const interruptSpeaking = useCallback(() => {
    if (voiceState === 'speaking') {
      stopAudio();
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      if (activeRef.current) {
        startRecognition();
      }
    }
  }, [voiceState, stopAudio, startRecognition]);

  const clearError = useCallback(() => setError(null), []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      activeRef.current = false;
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch {}
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
      }
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return {
    voiceModeActive,
    voiceState,
    transcript,
    lastResponseText,
    toggleVoiceMode,
    interruptSpeaking,
    error,
    clearError,
  };
}
