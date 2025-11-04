const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

// Database connection
const connectDB = require('./config/database');
const SocketHandler = require('./websocket/socketHandler');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: [
      'http://localhost:4028',
      'http://localhost:3000',
      'https://cms-ui-three.vercel.app',
      'https://cms.smartxalgo.com',
      process.env.FRONTEND_URL
    ].filter(Boolean),
    methods: ['GET', 'POST'],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

const PORT = process.env.PORT || 5000;

// Connect to MongoDB Atlas
connectDB();

// Initialize WebSocket handler
const socketHandler = new SocketHandler(io);

// Initialize SMS Cron Jobs
const smsCronJob = require('./cron/smsCron');
// smsCronJob.start();

// Initialize Task Update Monitoring Cron Jobs
const taskUpdateCron = require('./cron/taskUpdateCron');
taskUpdateCron.start();

const dataPipelineCron = require('./cron/data_pipeline');
dataPipelineCron.start();

// Initialize Task Update Notification Cron Jobs
const TaskNotificationCron = require('./cron/taskNotificationCron');
const taskNotificationCron = new TaskNotificationCron(socketHandler);
taskNotificationCron.start();

// Make socket handler and task notification cron available to routes
app.set('socketHandler', socketHandler);
app.set('taskNotificationCron', taskNotificationCron);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "ws:", "wss:"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

app.use(cors({
  origin: [
    'http://localhost:4028',
    'http://localhost:3000',
    'https://cms-ui-three.vercel.app',
    'https://cms.smartxalgo.com',
    process.env.FRONTEND_URL
  ].filter(Boolean),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'user-id', 'page', 'limit', 'start-date', 'end-date'],
  exposedHeaders: ['Content-Range', 'X-Content-Range'],
  maxAge: 600 // Cache preflight for 10 minutes
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/', limiter);

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 auth requests per windowMs
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api/auth', authLimiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
if (process.env.NODE_ENV === 'production') {
  app.use(morgan('combined'));
} else {
  app.use(morgan('dev'));
}

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check endpoint
app.get('/health', (req, res) => {
  const healthData = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    database: process.env.MONGODB_URI ? 'MongoDB Atlas' : 'Not connected',
    websocket: {
      connected: socketHandler.getConnectedUsers().length,
      status: 'active'
    },
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
    }
  };
  
  res.status(200).json(healthData);
});

app.get('/', (req, res) => {
  res.status(200).json({ message: 'Welcome to SmartXAlgo CRM API' });
});

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/attendance', require('./routes/attendance'));
app.use('/api/tasks', require('./routes/tasks'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/sms', require('./routes/sms'));
app.use('/api/cron', require('./routes/cron'));
app.use('/api/email', require('./routes/email'));

// WebSocket status endpoint
app.get('/api/websocket/status', (req, res) => {
  const connectedUsers = socketHandler.getConnectedUsers();
  res.json({
    success: true,
    data: {
      connectedUsers: connectedUsers.length,
      users: connectedUsers.map(user => ({
        id: user.user._id,
        name: `${user.user.firstName} ${user.user.lastName}`,
        role: user.user.role,
        connectedAt: user.connectedAt
      }))
    }
  });
});

// Catch-all handler for undefined routes
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.originalUrl
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  
  // Validation error (in-memory models)
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation Error',
      errors: err.errors || [err.message]
    });
  }
  
  // Duplicate key error (in-memory models)
  if (err.code === 'DUPLICATE_KEY') {
    return res.status(400).json({
      success: false,
      message: err.message || 'Duplicate entry'
    });
  }
  
  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid token'
    });
  }
  
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expired'
    });
  }
  
  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      success: false,
      message: 'File too large'
    });
  }
  
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      success: false,
      message: 'Unexpected file field'
    });
  }
  
  // Default error
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🗄️  Database: ${process.env.MONGODB_URI ? 'MongoDB Atlas' : 'Not configured'}`);
  console.log(`🔌 WebSocket: Enabled`);
  console.log(`🌐 CORS: ${process.env.FRONTEND_URL || 'http://localhost:4028'}`);
  
  if (process.env.NODE_ENV !== 'production') {
    console.log(`\n📋 Available endpoints:`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Auth: http://localhost:${PORT}/api/auth`);
    console.log(`   Users: http://localhost:${PORT}/api/users`);
    console.log(`   Attendance: http://localhost:${PORT}/api/attendance`);
    console.log(`   Tasks: http://localhost:${PORT}/api/tasks`);
    console.log(`   Dashboard: http://localhost:${PORT}/api/dashboard`);
    console.log(`   Email: http://localhost:${PORT}/api/email`);
    console.log(`   WebSocket: ws://localhost:${PORT}`);
  }
});

module.exports = app;