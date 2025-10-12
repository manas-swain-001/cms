const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

class Database {
  constructor() {
    this.connection = null;
    this.connected = false;
  }

  async connect() {
    try {
      // Check if MONGODB_URI is provided
      if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI environment variable is not set');
      }

      // Connect to MongoDB Atlas
      this.connection = await mongoose.connect(process.env.MONGODB_URI, {
        maxPoolSize: 10, // Maintain up to 10 socket connections
        serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
        socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      });

      this.connected = true;

      console.log('✅ MongoDB Atlas connected successfully');
      console.log(`📊 Database: ${this.connection.connection.name}`);
      console.log(`🔗 Host: ${this.connection.connection.host}:${this.connection.connection.port}`);
      console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);

      // Initialize default data after connection
      const { initializeDefaultUser } = require('../models/User');
      await initializeDefaultUser();

      // Handle connection events
      mongoose.connection.on('error', (err) => {
        console.error('❌ MongoDB connection error:', err);
        this.connected = false;
      });

      mongoose.connection.on('disconnected', () => {
        console.log('🔌 MongoDB disconnected');
        this.connected = false;
      });

      mongoose.connection.on('reconnected', () => {
        console.log('🔄 MongoDB reconnected');
        this.connected = true;
      });

      // Graceful shutdown handler
      process.on('SIGINT', async () => {
        await this.disconnect();
        process.exit(0);
      });

      return this.connection;
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error.message);
      this.connected = false;
      return null;
    }
  }

  async disconnect() {
    try {
      if (this.connection) {
        await mongoose.connection.close();
        this.connected = false;
        this.connection = null;
        console.log('🔌 MongoDB connection closed');
      }
    } catch (error) {
      console.error('❌ Error closing MongoDB connection:', error.message);
    }
  }

  getConnection() {
    return this.connection;
  }

  isConnected() {
    return this.connected;
  }

  getConnectionStatus() {
    return this.connected ? 'connected' : 'disconnected';
  }
}

// Create singleton instance
const database = new Database();

// Export the connection function
const connectDB = () => database.connect();

module.exports = connectDB;