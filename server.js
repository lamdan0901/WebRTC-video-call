const express = require("express");
const http = require("http");
const app = express();
const server = http.createServer(app);
const socket = require("socket.io");
const io = socket(server);
const wrtc = require("wrtc");

const rooms = {};
// const peers = {};
const streams = {};
let peerList = [];
let peerConn;
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
    peerConn = new wrtc.RTCPeerConnection(rtcConfig);

    console.log("-------------------------------------");

    //* if this is the first peer connecting to server
    // if (Object.keys(peers).length === 0) {
    if (peerList.length === 0) {
      // peerConn = peerConn;
      console.log("the first peer connecting to server");

      peerConn.ontrack = (event) => {
        streams[currRoomId] = [event.streams[0]];
      };
    } else {
      peerConn.ontrack = (event) => {
        if (oldEventStream?.id !== event.streams[0]?.id) {
          console.log(`// 1 send the new stream to old peers`);

          console.log("conn >>> curr stream: ", event.streams[0].id);

          peerList.forEach((conn) => {
            event.streams[0].getTracks().forEach((track) => {
              console.log("adding track", track.id);
              conn.addTrack(track, event.streams[0]);
            });
          });

          console.log(`// 2 send old streams to the new peer`);

          streams[currRoomId].forEach((stream) => {
            console.log("stream: ", stream.id);
            stream.getTracks().forEach((track) => {
              console.log("adding track", track.id);
              peerConn.addTrack(track, stream);
            });
          });

          console.log("// 3. save the new stream n the new peer");
          streams[currRoomId].push(event.streams[0]);
          oldEventStream = event.streams[0];
        }
      };
    }

    peerConn.onicecandidate = (event) => {
      if (event.candidate) {
        io.to(payload.caller).emit("ice-candidate", event.candidate);
      }
    };

    await peerConn.setRemoteDescription(
      new wrtc.RTCSessionDescription(payload.sdp)
    );
    const answer = await peerConn.createAnswer();
    await peerConn.setLocalDescription(answer);

    peerList.push(peerConn);

    io.to(payload.caller).emit("answer", answer);
  });

  socket.on("ice-candidate", (payload) => {
    peerConn.addIceCandidate(new wrtc.RTCIceCandidate(payload.candidate));
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
