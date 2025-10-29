const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  // User who owns this task record
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required']
  },
  
  // Date for this task record
  date: {
    type: Date,
    required: [true, 'Date is required'],
    default: Date.now
  },
  
  // Array of scheduled time entries for tracking updates
  scheduledEntries: [{
    scheduledTime: {
        type: String,
      required: [true, 'Scheduled time is required'],
      match: [/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Scheduled time must be in HH:MM format']
    },
    status: {
      type: String,
      enum: ['pending', 'submitted', 'warning_sent', 'escalated'],
      default: 'pending'
    },
    description: {
      type: String,
      trim: true,
      maxlength: [500, 'Description cannot exceed 500 characters'],
      default: ''
    },
    submittedAt: {
      type: Date,
      default: null
    },
    createdAt: {
    type: Date,
    default: Date.now
  }
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for formatted date
taskSchema.virtual('formattedDate').get(function() {
  return this.date.toISOString().split('T')[0];
});

// Virtual for total entries count
taskSchema.virtual('totalEntries').get(function() {
  return this.scheduledEntries.length;
});

// Virtual for submitted entries count
taskSchema.virtual('submittedEntries').get(function() {
  return this.scheduledEntries.filter(entry => entry.status === 'submitted').length;
});

// Virtual for pending entries count
taskSchema.virtual('pendingEntries').get(function() {
  return this.scheduledEntries.filter(entry => entry.status === 'pending').length;
});

// Virtual for last submitted time
taskSchema.virtual('lastSubmittedTime').get(function() {
  const submittedEntries = this.scheduledEntries.filter(entry => entry.status === 'submitted');
  if (submittedEntries.length === 0) return null;
  return submittedEntries[submittedEntries.length - 1].submittedAt;
});

// Index for better query performance
taskSchema.index({ userId: 1, date: 1 });
taskSchema.index({ userId: 1, 'scheduledEntries.createdAt': 1 });
taskSchema.index({ 'scheduledEntries.status': 1 });

// Pre-save middleware to sort scheduled entries by time
taskSchema.pre('save', function(next) {
  // Sort scheduled entries by scheduled time
  this.scheduledEntries.sort((a, b) => {
    const timeA = a.scheduledTime.split(':').map(Number);
    const timeB = b.scheduledTime.split(':').map(Number);
    return (timeA[0] * 60 + timeA[1]) - (timeB[0] * 60 + timeB[1]);
  });
  next();
});

// Instance method to create scheduled entries based on punch-in time
taskSchema.methods.createScheduledEntries = function(punchInTime) {
  const scheduledTimes = ['10:30', '12:00', '13:30', '16:00', '17:30'];
  const punchInHour = parseInt(punchInTime.split(':')[0]);
  const punchInMinute = parseInt(punchInTime.split(':')[1]);
  const punchInMinutes = punchInHour * 60 + punchInMinute;
  
  // Filter out scheduled times that have already passed
  const remainingTimes = scheduledTimes.filter(scheduledTime => {
    const scheduledHour = parseInt(scheduledTime.split(':')[0]);
    const scheduledMinute = parseInt(scheduledTime.split(':')[1]);
    const scheduledMinutes = scheduledHour * 60 + scheduledMinute;
    return scheduledMinutes > punchInMinutes;
  });
  
  // Create scheduled entries for remaining times
  remainingTimes.forEach(scheduledTime => {
    this.scheduledEntries.push({
      scheduledTime: scheduledTime,
      status: 'pending',
      description: '',
      submittedAt: null,
      createdAt: new Date()
    });
  });
  
  return this.save();
};

// Instance method to submit an update for a scheduled entry
taskSchema.methods.submitUpdate = function(scheduledTime, description) {
  const entry = this.scheduledEntries.find(e => e.scheduledTime === scheduledTime);
  if (!entry) {
    throw new Error('Scheduled entry not found');
  }
  
  if (entry.status === 'submitted') {
    throw new Error('Entry already submitted');
  }
  
  entry.status = 'submitted';
  entry.description = description.trim();
  entry.submittedAt = new Date();
  
  return this.save();
};

// Instance method to update entry status
taskSchema.methods.updateEntryStatus = function(scheduledTime, status) {
  const entry = this.scheduledEntries.find(e => e.scheduledTime === scheduledTime);
  if (!entry) {
    throw new Error('Scheduled entry not found');
  }
  
  if (!['pending', 'submitted', 'warning_sent', 'escalated'].includes(status)) {
    throw new Error('Invalid status');
  }
  
  entry.status = status;
  
  return this.save();
};

// Static method to get user's tasks for a date range
taskSchema.statics.getUserTasks = async function(userId, startDate, endDate) {
  return await this.find({
    userId: userId,
    date: {
      $gte: startDate,
      $lte: endDate
    }
  }).sort({ date: -1 });
};

// Static method to get today's task for a user
taskSchema.statics.getTodayTask = async function(userId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  return await this.findOne({
    userId: userId,
    date: {
      $gte: today,
      $lt: tomorrow
    }
  });
};

// Static method to create or get today's task
taskSchema.statics.createOrGetTodayTask = async function(userId) {
  let task = await this.getTodayTask(userId);
  
  if (!task) {
    task = new this({
      userId: userId,
      date: new Date()
    });
    await task.save();
  }
  
  return task;
};

// Static method to create task with scheduled entries based on punch-in
taskSchema.statics.createTaskWithPunchIn = async function(userId, punchInTime) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Check if task already exists
  let task = await this.findOne({
    userId: userId,
    date: today
  });
  
  if (task) {
    // If task exists, clear existing entries and recreate based on punch-in time
    task.scheduledEntries = [];
  } else {
    // Create new task
    task = new this({
      userId: userId,
      date: today
    });
  }
  
  // Create scheduled entries based on punch-in time
  await task.createScheduledEntries(punchInTime);
  
  return task;
};

// Static method to get team tasks for a specific date
taskSchema.statics.getTeamTasks = async function(userIds, date) {
  const startDate = new Date(date);
  startDate.setHours(0, 0, 0, 0);
  
  const endDate = new Date(date);
  endDate.setHours(23, 59, 59, 999);
  
  return await this.find({
    userId: { $in: userIds },
    date: {
      $gte: startDate,
      $lte: endDate
    }
  }).populate('userId', 'firstName lastName email employeeId office');
};

// Create the model
const Task = mongoose.model('Task', taskSchema);

module.exports = Task;