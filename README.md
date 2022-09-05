# HexHoot

<p align="center">
    <a href="//hexhoot.com"><img src="https://raw.githubusercontent.com/zenineasa/hexhoot/main/modules/ImagePack/images/icon.svg" width="200" height="200"></a>
</p>

This is an attempt to create an Opensource Peer-to-peer Social Network with Zero-Knowledge-Proof based authentication. The objective is to democratize social networking by eliminating any form of central servers.

The initial target is to release a desktop version that can be installed and run on Linux, macOS and Windows.


## About

Internet is supposed to be free; free as in "libre" and not "gratis". There are plenty of implementations of social networks around. Most of them have central servers, run by their makers, that handle all aspects of it.

The issue with having a centralized server is that there is an organization that holds on to all the information created by its users. In many cases, the users who created the content no longer own the content once posted; the ownership is transferred to the company that runs the social network. Furthermore, these platforms can take down any users or content as they choose to, (as some Youtubers have described) like a god.

Even the best efforts to implement a social network in a peer-to-peer manner would have a centralized server to authenticate and verify the user. We would like to change that.

Our goal is to create a social network wherein the users own, control and host their information. There is no central server involved even for authentication; we accomplish this by using Zero Knowledge Proof strategies.


## RFA

### R - Requirements

A social network that:

1. Values privacy of the users
2. Collects no data from the users
3. Users own and host all the data on their devices
4. No servers are involved; not even for user authentication.
5. Has essential features of a modern social network.
6. Should be less addictive than modern social networks.
7. Personalizable templates, themes, etc.
8. Open-source, so that there would be no trust issues.

### F - Functionalities / Functional Design

1. Ability to create and share profiles
2. Ability to connect two profiles (add as a friend or follow) by scanning a QR code.
3. Send private messages.
4. Form groups and send messages.
5. Write a post and share a photo or video that is viewable to anyone to whom the profile is connected.

### A - Architecture

Everything shall be modules, including the engine. Each module will be written in a Model-View-Controller design. Modules shall have a JSON file that informs which other modules the module is dependent on.

For message communication, we could use Hyperswarm (based on Hypercore).

TODO: Architecture diagrams need to be added here

## Tasks

The following Trello board captures all the tasks that need to be done, that are actively worked upon and that have been completed.

https://trello.com/b/cvbsEOpe/hexhoot

## Try it out

As a prerequisite to using Hexhoot, you would need to install Node.js on your computer. The following link would help you with the same.

https://nodejs.dev/en/download/

After that, you simply have to open your Terminal / CMD, go to the directory where you downloaded this source code and run the following commands:

```
npm install
npm start
```

## Other Important commands

Build everything:

```
make
```


Clean the build:

```
make clean
```


Start the application:

```
npm start
```

## Before submitting

Run the following command to ensure that all the Javascript files follow the coding standards.

```
make lint
```

Run the following command to ensure that all the tests are running fine

```
npm run test
```

Copyright &copy; 2022 Zenin Easa Panthakkalakath
