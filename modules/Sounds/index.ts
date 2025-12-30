/* Copyright (c) 2022-2025 Zenin Easa Panthakkalakath */

/**
 * This class implements the different sounds or tones used in the UI.
 */
export default class Sounds {
    private static _instance: Sounds;
    private audioContext: AudioContext;

    /** This is the constructor (note the singleton implementation) */
    constructor() {
        if (Sounds._instance) {
            return Sounds._instance;
        }
        Sounds._instance = this;
        this.initialize();
    }

    /**
     * Initialize Sounds
     */
    initialize() {
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        this.audioContext = new AudioContext();
    }

    /**
     * Play from an array of notes.
     * @param {Array} notes all the notes involed in making this tune
     * @param {number} duration total amount of time for which this tune plays
     */
    playFromArray(notes: string[], duration: number) {
        const dt = duration / notes.length;
        const startTime = this.audioContext.currentTime;
        for (let i = 0; i < notes.length; i++) {
            const oscillator = this.audioContext.createOscillator();
            oscillator.connect(this.audioContext.destination);
            oscillator.frequency.setValueAtTime(
                this.noteToFrequency(notes[i]),
                startTime + i * dt
            );
            oscillator.start(startTime + i * dt);
            oscillator.stop(startTime + (i + 1) * dt);
        }
    }

    /**
     * Mapping frequency to notes
     */
    noteToFrequency(note: string) {
        const notesMap: {[key: string]: number} = {
            'C4': 261.63,
            'D4': 293.66,
            'E4': 329.63,
            'F4': 349.23,
            'G4': 392.00,
            'A4': 440.00,
            'B4': 493.88
        };
        return notesMap[note] || 0;
    }

    /**
     * Sound to be played when you receive a message
     */
    messageReceivedSound() {
        this.playFromArray(['G4', 'A4', 'G4', 'A4'], 0.5);
    }
}
