const express = require("express");
const http = require("http");
const app = express();
const server = http.createServer(app);
const socket = require("socket.io");
const io = socket(server);
const wrtc = require("wrtc");

const rooms = {};
const streams = {};
let myConnection;
let currRoomId;
let oldEventStream;

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun2.1.google.com:19302" },
    {
      urls: "turn:192.158.29.39:3478?transport=udp",
      credential: "JZEOEt2V3Qb0y27GRntt2u2PAYA=",
      username: "28224511:1379330808",
    },
    {
      urls: "turn:192.158.29.39:3478?transport=tcp",
      credential: "JZEOEt2V3Qb0y27GRntt2u2PAYA=",
      username: "28224511:1379330808",
    },
  ],
};

io.on("connection", (socket) => {
  socket.on("join room", (roomID) => {
    currRoomId = roomID;

    // if this room existed n this user has never been here before
    if (rooms[roomID] && !rooms[roomID].includes(socket.id)) {
      rooms[roomID].push(socket.id);
    } else {
      rooms[roomID] = [socket.id];
      socket.emit("joined room");
    }

    const otherUsers = rooms[roomID].filter((id) => id !== socket.id);

    if (otherUsers.length !== 0) {
      socket.emit("other users in the room", otherUsers);

      otherUsers.forEach((id) => {
        socket.to(id).emit("new user joined", socket.id);
      });
    }
  });

  socket.on("offer", async (payload) => {
    console.log("socket on offer");
    // if (!myConnection) {
    myConnection = new wrtc.RTCPeerConnection(rtcConfig);
    // }

    myConnection.onicecandidate = (event) => {
      // console.log("myConnection on onicecandidate");
      if (event.candidate) {
        io.to(payload.caller).emit("ice-candidate", event.candidate);
      }
    };

    myConnection.ontrack = (event) => {
      console.log("myConnection on ontrack");

      if (oldEventStream?.id !== event.streams[0]?.id) {
        event.streams[0].getTracks().forEach((track) => {
          myConnection.addTrack(track, event.streams[0]);
        });

        oldEventStream = event.streams[0];

        if (streams[currRoomId]) {
          streams[currRoomId].push(event.streams[0]);
        } else {
          streams[currRoomId] = [event.streams[0]];
        }

        // console.log(JSON.stringify(event.streams[0]));

        // console.log("streams[currRoomId]", streams[currRoomId]);

        // socket.broadcast.emit("update streams", streams[currRoomId]);
      }
    };

    await myConnection.setRemoteDescription(
      new wrtc.RTCSessionDescription(payload.sdp)
    );
    const answer = await myConnection.createAnswer();
    await myConnection.setLocalDescription(answer);

    io.to(payload.caller).emit("answer", answer);
  });

  socket.on("answer", (payload) => {
    myConnection
      .setRemoteDescription(new wrtc.RTCSessionDescription(payload.sdp))
      .catch((e) => console.log(e));
  });

  socket.on("ice-candidate", (payload) => {
    myConnection.addIceCandidate(new wrtc.RTCIceCandidate(payload.candidate));
  });

  socket.on("stop sharing screen", (userId) => {
    io.to(userId).emit("stop sharing screen");
  });

  socket.on("disconnect", () => {
    console.log(new Date().toLocaleTimeString() + " disconnected");
    socket.broadcast.emit("user left");
  });

  socket.on("trigger disconnect", () => {
    socket.disconnect(true);
    socket.broadcast.emit("user left");
  });
});

server.listen(8000, () => console.log("server is running on port 8000"));
