const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const mongoose = require("mongoose");
require("dotenv").config(); // Live karne ke liye zaroori hai

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Database Connection (Live aur Local dono ke liye)
const mongoURI = process.env.MONGO_URI || "mongodb://localhost:27017/callApp";
mongoose.connect(mongoURI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.error("❌ DB Error:", err));

const callSchema = new mongoose.Schema({
  callerId: String,
  receiverId: String,
  status: String, // "completed", "rejected", "missed"
  startTime: { type: Date, default: Date.now },
  duration: Number
});
const CallLog = mongoose.model("CallLog", callSchema);

let users = {}; // userId -> socketId
let userStatus = {}; // userId -> "online" or "busy"

io.on("connection", (socket) => {
  // 1. User Join
  socket.on("join", ({ userId }) => {
    users[userId] = socket.id;
    userStatus[userId] = "online";
    console.log(`👤 ${userId} is now Online`);
    io.emit("update-user-list", { 
      users: Object.keys(users), 
      status: userStatus 
    });
  });

  // 2. Call Request
  socket.on("call-request", (data) => {
    const targetSocket = users[data.to];
    if (targetSocket) {
      if (userStatus[data.to] === "busy") {
        socket.emit("call-response", { status: "busy" });
      } else {
        io.to(targetSocket).emit("incoming-call", data);
      }
    }
  });

  // 3. Call Accept
  socket.on("answer-call", (data) => {
    const targetSocket = users[data.to];
    if (targetSocket) {
      userStatus[data.from] = "busy";
      userStatus[data.to] = "busy";
      io.to(targetSocket).emit("call-accepted", data);
      io.emit("update-user-list", { users: Object.keys(users), status: userStatus });
    }
  });

  // 4. Call Reject
  socket.on("reject-call", ({ to }) => {
    const targetSocket = users[to];
    if (targetSocket) {
      io.to(targetSocket).emit("call-rejected");
    }
  });

  // 5. ICE Candidates (Audio/Video Path)
  socket.on("ice-candidate", (data) => {
    const targetSocket = users[data.to];
    if (targetSocket) {
      io.to(targetSocket).emit("ice-candidate", { candidate: data.candidate });
    }
  });

  // 6. End Call & Save Log
  socket.on("end-call", async ({ from, to, duration }) => {
    userStatus[from] = "online";
    userStatus[to] = "online";
    
    await CallLog.create({ callerId: from, receiverId: to, duration, status: "completed" });
    
    const targetSocket = users[to];
    if (targetSocket) io.to(targetSocket).emit("call-ended");
    
    io.emit("update-user-list", { users: Object.keys(users), status: userStatus });
    io.emit("refresh-logs");
  });

  socket.on("disconnect", () => {
    let disconnectedUser = "";
    for (let id in users) {
      if (users[id] === socket.id) {
        disconnectedUser = id;
        delete users[id];
        delete userStatus[id];
        break;
      }
    }
    io.emit("update-user-list", { users: Object.keys(users), status: userStatus });
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server on port ${PORT}`));