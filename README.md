# HexHoot
<p align="center">
    <a href="//hexhoot.com">
        <picture>
            <source media="(prefers-color-scheme: light)" srcset="./modules/ImagePack/images/icon_lightmode.svg">
            <img src="./modules/ImagePack/images/icon.svg" width="200" height="200">
        </picture>
    </a>
</p>

This is an attempt to create an Opensource Peer-to-peer communication platform with Zero-Knowledge-Proof based authentication. The objective is to democratize communication by eliminating any form of central servers.

Currently, HexHoot's standalone desktop installers are available for Linux (Debian and RPM), macOS and Windows; users can chat with each other over the internet and the intranet. Download it from our release page, linked below.

https://github.com/zenineasa/HexHoot/releases/latest

## Why HexHoot?

The following question is something that people would ask me quite often when I talk to them about HexHoot. If you look around, you can see quite a lot of software, like WhatsApp, Slack, Microsoft Teams, Zoom, etc., that helps in communication. Why would one attempt to create yet another tool that solves the same problem?

The thing is, we are not exactly trying to compete with the existing communication platforms head-on; rather, we are setting up a framework that would enable the concept of user authentication in applications that can run without any centralized servers.

Much of the traditional softwares that enabled Peer-to-Peer communication relied on a centralized server to authenticate users, not because they wanted to do this, but because that was probably the only way at the time. We, on the other hand, have accomplished to solve this using Zero-knowledge-proof strategies.

Internet is supposed to be free; free as in "libre" and not "gratis". There is a tendancy in the world that certain closed source algorithms are actively deciding what content the people must be exposed to. You can't view their source code, while they read each and everything about you.

We would like to reverse that. HexHoot is an Open Source project that is aimed at creating a platform for communication between people, while all data is stored locally on the users' computers.


## Try the development version

If you are someone who likes to run the most updated version that is still under development, you would not regret following the belowmentioned instructions.

1. Prerequisite: Download and install Node.js from the following link.
    https://nodejs.dev/en/download/
2. Clone this repository to your computer.
3. Go to the cloned repository using your Terminal/CMD, and run the following commands to install the necessary packages.
   ```
   make install
   ```
4. Now, use the following command to start HexHoot Development version.
   ```
   npm start
   ```

Copyright &copy; 2022-2024 Zenin Easa Panthakkalakath
