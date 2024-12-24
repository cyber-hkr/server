const http = require("http");
const express = require("express");
const cors = require("cors");
const socketio = require("socket.io");
const { ExpressPeerServer } = require("peer");
const mongoose = require("mongoose");
const session = require("express-session");
const passport = require("passport");
const passportLocalMongoose = require("passport-local-mongoose");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const findOrCreate = require("mongoose-findorcreate");
const bodyParser = require("body-parser");
require("dotenv").config();

const { addUser , removeUser , getUser , getUsersInsessionid } = require("./users");
const sessionRoutes = require("./routes/session");
const { Session } = require("./models/session");

const app = express();

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(cors({
  origin: "https://client-we9f.onrender.com", // Your deployed React app URL
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true,
}));

// Session setup
app.use(session({
  secret: "Our little secret.",
  resave: false,
  saveUninitialized: false,
}));

app.use(passport.initialize());
app.use(passport.session());

// MongoDB Atlas connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("Connected to MongoDB Atlas"))
.catch(err => console.error("MongoDB connection error:", err));

// User schema and passport setup
const userSchema = new mongoose.Schema({
  username: String,
  user_id: Number,
  user_details: Object,
});
userSchema.plugin(passportLocalMongoose);
userSchema.plugin(findOrCreate);
const User = mongoose.model("User ", userSchema);

passport.use(User.createStrategy());
passport.serializeUser ((user, done) => {
  done(null, user.id);
});
passport.deserializeUser ((id, done) => {
  User.findById(id, (err, user) => {
    done(err, user);
  });
});

// Google OAuth setup
passport.use(new GoogleStrategy({
  clientID: process.env.CLIENT_ID,
  clientSecret: process.env.CLIENT_SECRET,
  callbackURL: "https://your-backend-url.com/auth/google/callback", // Update with your backend URL
  userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
}, (accessToken, refreshToken, profile, cb) => {
  User.findOrCreate({
    user_id: profile.id,
    username: profile.displayName,
    user_details: profile.name,
  }, (err, user) => {
    return cb(err, user);
  });
}));

// Routes
app.get("/auth/google", passport.authenticate("google", { scope: ["profile"] }));
app.get("/auth/google/callback", passport.authenticate("google", { failureRedirect: "https://client-we9f.onrender.com" }), (req, res) => {
  res.redirect("https://client-we9 f.onrender.com/userhome");
});

app.get("/logout", (req, res) => {
  req.logout();
  res.redirect("https://client-we9f.onrender.com/");
});

// Socket.io setup
const server = http.createServer(app);
const io = socketio(server, {
  cors: {
    origin: "https://client-we9f.onrender.com",
  },
});

// Socket.io events
io.on("connect", (socket) => {
  socket.on("join", ({ name, sessionid }, callback) => {
    const { error, user } = addUser ({ id: socket.id, name, sessionid });
    if (error) return callback(error);

    socket.join(user.sessionid);
    socket.emit("message", { user: "admin", text: `${user.name}, welcome to sessionid ${user.sessionid}.` });
    socket.broadcast.to(user.sessionid).emit("message", { user: "admin", text: `${user.name} has joined!` });

    io.to(user.sessionid).emit("sessionidData", {
      sessionid: user.sessionid,
      users: getUsersInsessionid(user.sessionid),
    });

    callback();
  });

  socket.on("disconnect", () => {
    const user = removeUser (socket.id);
    if (user) {
      io.to(user.sessionid).emit("message", { user: "Admin", text: `${user.name} has left.` });
      io.to(user.sessionid).emit("sessionidData", {
        sessionid: user.sessionid,
        users: getUsersInsessionid(user.sessionid),
      });
    }
  });
});

// Start the server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});