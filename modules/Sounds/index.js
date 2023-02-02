/* Copyright (c) 2022-2023 Zenin Easa Panthakkalakath */

const Tone = require('tone');

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
        this.synth = new Tone.Synth().toDestination();
    }

    /**
     * Play from an array of notes.
     * @param {Array} notes all the notes involed in making this tune
     * @param {Array} duration total amount of time for which this tune plays
     */
    playFromArray(notes, duration) {
        const dt = duration / notes.length;
        const now = Tone.now();
        for (let i = 0; i < notes.length; i++) {
            this.synth.triggerAttackRelease(
                notes[i], '16n', now + i * dt);
        }
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
