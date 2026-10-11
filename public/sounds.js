// -------------------------------------------------------------------
// Suit Duel Sound Effects
// All sounds are synthesized with the Web Audio API (no audio files needed).
// Usage: SFX.play('name', optionalArg)
// -------------------------------------------------------------------

const SFX = (() => {
    let ctx = null;
    let master = null;
    let noiseBuffer = null;

    // Lazily create the audio context (browsers require a user gesture first)
    function getCtx() {
        if (!ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return null;
            ctx = new AudioCtx();
            master = ctx.createGain();
            master.gain.value = 0.5;
            master.connect(ctx.destination);

            // One second of white noise, reused for card/whoosh sounds
            noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
            const data = noiseBuffer.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    // Simple oscillator note with attack/decay envelope and optional pitch slide
    function tone(freq, start, dur, { type = 'sine', vol = 0.3, endFreq = null } = {}) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, start);
        if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, start + dur);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(vol, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        osc.connect(gain).connect(master);
        osc.start(start);
        osc.stop(start + dur + 0.05);
    }

    // Filtered noise burst (card flicks, swooshes, impacts)
    function noise(start, dur, { vol = 0.3, freq = 2000, endFreq = null, q = 1, filter = 'bandpass' } = {}) {
        const src = ctx.createBufferSource();
        const bpf = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        src.buffer = noiseBuffer;
        bpf.type = filter;
        bpf.Q.value = q;
        bpf.frequency.setValueAtTime(freq, start);
        if (endFreq) bpf.frequency.exponentialRampToValueAtTime(endFreq, start + dur);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(vol, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        src.connect(bpf).connect(gain).connect(master);
        src.start(start);
        src.stop(start + dur + 0.05);
    }

    function cardFlick(t, vol = 0.25) {
        noise(t, 0.08, { vol, freq: 3500, endFreq: 1500, q: 0.8 });
    }

    const sounds = {
        // UI button press
        click(t) {
            tone(660, t, 0.06, { type: 'square', vol: 0.08 });
        },
        // Selecting / deselecting a card to discard
        select(t) {
            tone(1200, t, 0.04, { type: 'triangle', vol: 0.12 });
        },
        // Card slapped onto the table
        cardPlay(t) {
            noise(t, 0.15, { vol: 0.35, freq: 1800, endFreq: 600, q: 0.7 });
            tone(140, t, 0.08, { vol: 0.15, endFreq: 80 });
        },
        // Drawing one or more cards
        draw(t, count = 1) {
            const n = Math.max(1, Math.min(count, 6));
            for (let i = 0; i < n; i++) cardFlick(t + i * 0.08);
        },
        // Reshuffling the discard pile into the deck
        shuffle(t) {
            for (let i = 0; i < 14; i++) cardFlick(t + i * 0.04 + Math.random() * 0.015, 0.15);
        },
        // ♥ Heal: rising sparkle
        heal(t) {
            [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, t + i * 0.07, 0.3, { vol: 0.15 }));
        },
        // ♠ Damage: low impact thud
        damage(t) {
            tone(180, t, 0.25, { vol: 0.5, endFreq: 45 });
            noise(t, 0.12, { vol: 0.35, freq: 900, q: 0.5, filter: 'lowpass' });
        },
        // ♣ / hand limit: cards thrown away
        discard(t) {
            noise(t, 0.3, { vol: 0.3, freq: 2500, endFreq: 300, q: 1.2 });
            tone(400, t, 0.25, { type: 'triangle', vol: 0.1, endFreq: 150 });
        },
        // Player is being asked to choose cards to discard
        alert(t) {
            tone(440, t, 0.12, { type: 'triangle', vol: 0.15 });
            tone(330, t + 0.13, 0.18, { type: 'triangle', vol: 0.15 });
        },
        // Player's turn begins
        turn(t) {
            tone(880, t + 0.2, 0.15, { vol: 0.1 });
            tone(1318.5, t + 0.3, 0.25, { vol: 0.1 });
        },
        // Online game found / game started
        start(t) {
            [392, 523.25, 659.25].forEach((f, i) => tone(f, t + i * 0.1, 0.25, { type: 'triangle', vol: 0.15 }));
        },
        win(t) {
            [523.25, 659.25, 783.99].forEach((f, i) => tone(f, t + i * 0.12, 0.2, { type: 'square', vol: 0.08 }));
            tone(1046.5, t + 0.36, 0.6, { type: 'square', vol: 0.08 });
            tone(523.25, t + 0.36, 0.6, { type: 'triangle', vol: 0.15 });
        },
        lose(t) {
            [392, 349.23, 311.13].forEach((f, i) => tone(f, t + i * 0.2, 0.25, { type: 'triangle', vol: 0.18 }));
            tone(261.63, t + 0.6, 0.8, { type: 'triangle', vol: 0.18, endFreq: 240 });
        },
        tie(t) {
            tone(523.25, t, 0.25, { type: 'triangle', vol: 0.15 });
            tone(523.25, t + 0.3, 0.4, { type: 'triangle', vol: 0.15 });
        },
        // Server error / disconnect
        error(t) {
            tone(150, t, 0.3, { type: 'sawtooth', vol: 0.1 });
        }
    };

    function play(name, arg) {
        try {
            const c = getCtx();
            if (!c || !sounds[name]) return;
            sounds[name](c.currentTime, arg);
        } catch (error) {
            console.warn("Sound playback failed:", name, error);
        }
    }

    // Unlock audio on the first user interaction
    document.addEventListener('pointerdown', () => getCtx(), { once: true });

    return { play };
})();
