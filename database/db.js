const { MongoClient } = require("mongodb");
require("dotenv").config();

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const dbName = process.env.MONGODB_DB || "greenedge";

const client = new MongoClient(uri);
let db = null;

async function connectDB() {
    if (db) return db;

    await client.connect();
    db = client.db(dbName);

    // Har user ki id database mein unique rahegi
    await db.collection("users").createIndex({ userId: 1 }, { unique: true });

    console.log(`✅ MongoDB connected: ${dbName}`);
    return db;
}

function users() {
    if (!db) throw new Error("MongoDB is not connected yet.");
    return db.collection("users");
}

module.exports = { connectDB, users };