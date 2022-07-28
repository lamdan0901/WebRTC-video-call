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
    {
      urls: "stun:stun.stunprotocol.org",
    },
    {
      urls: "turn:numb.viagenie.ca",
      credential: "muazkh",
      username: "webrtc@live.com",
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
    if (!myConnection) {
      myConnection = new wrtc.RTCPeerConnection(rtcConfig);
    }

    myConnection.onnegotiationneeded = () => handleNegotiationNeeded();

    myConnection.onicecandidate = (event) => {
      console.log("myConnection on onicecandidate");
      if (event.candidate) {
        io.to(payload.caller).emit("ice-candidate", event.candidate);
      }
    };

    myConnection.ontrack = (event) => {
      console.log("myConnection on ontrack");

      if (oldEventStream !== event.streams[0]) {
        event.streams[0].getTracks().forEach((track) => {
          myConnection.addTrack(track, event.streams[0]);
        });

        console.log("myConnection add tracks");
        oldEventStream = event.streams[0];
      }

      console.log("streams[currRoomId]", streams[currRoomId]);

      if (streams[currRoomId]) {
        streams[currRoomId].push(event.streams[0]);
      } else {
        streams[currRoomId] = [event.streams[0]];
      }
    };

    await myConnection.setRemoteDescription(
      new wrtc.RTCSessionDescription(payload.sdp)
    );
    const answer = await myConnection.createAnswer();
    await myConnection.setLocalDescription(answer);

    io.to(payload.caller).emit("answer", answer);
  });

  async function handleNegotiationNeeded(userID) {
    console.log("server handle Negotiation");

    const offer = await myConnection.createOffer();
    await myConnection.setLocalDescription(offer);

    const payload = {
      sdp: myConnection.localDescription,
    };

    socketRef.current.emit("offer", payload);
  }

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
