require('dotenv').config();  // Load environment variables
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo')(session);
const WebSocket = require("ws");
const { exec } = require("child_process");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");


const app = express();

// Define PORT before using it
const PORT = process.env.PORT || 3000;

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}, (err) => {
    console.log(err ? 'Error in DB connection: ' + err : 'MongoDB Connection Succeeded.');
});

// Get the Mongoose connection
const db = mongoose.connection;

// Session Setup
app.use(session({
    secret: process.env.SESSION_SECRET, // Use environment variable
    resave: true,
    saveUninitialized: true,
    store: new MongoStore({ mongooseConnection: db }) // Use the Mongoose connection
}));

// Middleware
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.static(__dirname + '/views'));

var index = require('./routes/index');
app.use('/', index);


// Error Handling
app.use((req, res, next) => {
    next(new Error('File Not Found', { status: 404 }));
});

app.use((err, req, res, next) => {
    res.status(err.status || 500).send(err.message);
});

// Start Server
const server = app.listen(PORT, () => {
    console.log('Server is started on http://127.0.0.1:' + PORT);
});

// WebSocket Server
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
    ws.on("message", (message) => {
        try {
            const { language, code, userInput } = JSON.parse(message);
            if (!language || !code) {
                throw new Error("Invalid message format: 'language' and 'code' are required.");
            }
            runCode(ws, language, code, userInput);
        } catch (error) {
            ws.send(`Error: ${error.message}`);
        }
    });

    ws.on("error", (error) => {
        console.error("WebSocket error:", error);
    });
});

// Function to generate unique file names
const getUniqueFilename = (ext) => path.join(os.tmpdir(), `temp-${crypto.randomUUID()}${ext}`);

// Run Code Function
const runCode = (ws, language, code, userInput = "") => {
    const fileExt = { "python": ".py", "javascript": ".js", "cpp": ".cpp", "java": ".java" };

    if (!fileExt[language]) {
        ws.send("Unsupported language");
        return;
    }

    // Generate unique file paths
    const filePath = getUniqueFilename(fileExt[language]);
    const inputPath = getUniqueFilename(".txt");

    // Declare exePath before usage
    let exePath = null;
    let command;
    let className = "";

    // Write code and input to temp files
    fs.writeFileSync(filePath, code);
    fs.writeFileSync(inputPath, userInput);

    switch (language) {
        case "python":
            command = `python ${filePath} < ${inputPath}`;
            break;

        case "javascript":
            command = `node ${filePath} < ${inputPath}`;
            break;

        case "cpp":
            exePath = getUniqueFilename(".exe");  // Now defined properly
            command = `g++ ${filePath} -o ${exePath} && ${exePath} < ${inputPath}`;
            break;

        case "java":
            const classNameMatch = code.match(/class (\w+)/);
            if (!classNameMatch) {
                ws.send("Error: Java class name not found.");
                return;
            }
            className = classNameMatch[1];
            command = `javac ${filePath} && java -cp ${path.dirname(filePath)} ${className} < ${inputPath}`;
            break;
    }

    exec(command, (error, stdout, stderr) => {
        if (error) {
            ws.send(`Error: ${stderr}`);
        } else {
            ws.send(stdout);
        }

        // Cleanup temporary files safely
        fs.unlink(filePath, () => {});
        fs.unlink(inputPath, () => {});
        if (language === "cpp" && exePath) fs.unlink(exePath, () => {});  // Now exePath is properly scoped
    });
};

// Global cleanup for orphaned files when server shuts down
process.on("exit", () => {
    fs.readdir(os.tmpdir(), (err, files) => {
        if (err) return;
        files.forEach(file => {
            if (file.startsWith("temp-")) fs.unlink(path.join(os.tmpdir(), file), () => {});
        });
    });
});





console.log("WebSocket Server is running!");