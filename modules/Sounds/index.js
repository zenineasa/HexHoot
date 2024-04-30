/* Copyright (c) 2022-2024 Zenin Easa Panthakkalakath */

/**
 * This class implements the different sounds or tones used in the UI.
 */
class Sounds {
    /** This is the constructor (note the singleton implementation) */
    constructor() {
        if (Sounds._instance) {
            return Sounds._instance;
        }
        Sounds._instance = this;
        Sounds._instance.initialize();
    }

    /**
     * Initialize Sounds
     */
    initialize() {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioContext();
    }

    /**
     * Play from an array of notes.
     * @param {Array} notes all the notes involed in making this tune
     * @param {Array} duration total amount of time for which this tune plays
     */
    playFromArray(notes, duration) {
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
    noteToFrequency(note) {
        const notesMap = {
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

module.exports = function() {
    return new Sounds();
};
