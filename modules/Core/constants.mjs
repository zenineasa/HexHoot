/* Copyright (c) 2026 Zenin Easa Panthakkalakath */

// Constants shared by Core and the renderer's Core client. An ES module, so
// the renderer can import it; Core loads it with require().

// Data table names; like enum
export const tableNames = Object.freeze({
    friends: 'Friends',
    chat: 'Chat',
    loggedInUser: 'LoggedInUserInfo',
    preferences: 'Preferences',
});

// Message types; like enum
export const messageType = Object.freeze({
    chat: 'ChatMessage',
    friendRequest: 'FriendRequest',
    userInfoResponse: 'UserInformation',
});

// Core methods that a renderer may call over IPC. Anything not listed here
// (for example, injecting a received message) is internal to Core.
export const rendererMethods = Object.freeze([
    'getAccountState',
    'writeLoggedInUserInfo',
    'unlock',
    'getLoggedInUserInfoPublic',
    'getMyAddress',
    'getAllFriends',
    'getUserInfo',
    'addFriend',
    'getPendingFriendRequests',
    'acceptFriendRequest',
    'declineFriendRequest',
    'getSafetyNumber',
    'sendChatMessage',
    'getAllMessages',
    'markChatRead',
    'setPreference',
    'getPreference',
    'getPasswordCheck',
    'checkPassword',
    'skipPasswordCheck',
    'exportBackup',
    'importBackup',
    'deleteDatabaseContent',
    'getTransportStatus',
]);
