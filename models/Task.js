const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  // Basic Information
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required']
  },
  date: {
    type: Date,
    required: [true, 'Date is required'],
    default: Date.now
  },
  
  // Task Slots
  slots: {
    morning: {
      status: {
        type: String,
        enum: ['pending', 'in_progress', 'completed', 'cancelled'],
        default: 'pending'
      },
      description: {
        type: String,
        default: ''
      },
      startTime: {
        type: Date,
        default: null
      },
      endTime: {
        type: Date,
        default: null
      },
      timeWindow: {
        start: {
          type: String,
          default: '09:00'
        },
        end: {
          type: String,
          default: '12:00'
        }
      },
      priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'medium'
      },
      tags: [String],
      attachments: [{
        name: String,
        url: String,
        uploadedAt: {
          type: Date,
          default: Date.now
        }
      }],
      comments: [{
        text: String,
        author: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        },
        createdAt: {
          type: Date,
          default: Date.now
        }
      }],
      completionPercentage: {
        type: Number,
        min: 0,
        max: 100,
        default: 0
      },
      blockers: [String],
      tasks: [{
        id: Number,
        title: String,
        description: String,
        status: {
          type: String,
          enum: ['pending', 'in_progress', 'completed', 'cancelled'],
          default: 'pending'
        },
        notes: String,
        startedAt: Date,
        completedAt: Date,
        priority: {
          type: String,
          enum: ['low', 'medium', 'high', 'urgent'],
          default: 'medium'
        }
      }]
    },
    afternoon: {
      status: {
        type: String,
        enum: ['pending', 'in_progress', 'completed', 'cancelled'],
        default: 'pending'
      },
      description: {
        type: String,
        default: ''
      },
      startTime: {
        type: Date,
        default: null
      },
      endTime: {
        type: Date,
        default: null
      },
      timeWindow: {
        start: {
          type: String,
          default: '13:00'
        },
        end: {
          type: String,
          default: '17:00'
        }
      },
      priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'medium'
      },
      tags: [String],
      attachments: [{
        name: String,
        url: String,
        uploadedAt: {
          type: Date,
          default: Date.now
        }
      }],
      comments: [{
        text: String,
        author: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        },
        createdAt: {
          type: Date,
          default: Date.now
        }
      }],
      completionPercentage: {
        type: Number,
        min: 0,
        max: 100,
        default: 0
      },
      blockers: [String],
      tasks: [{
        id: Number,
        title: String,
        description: String,
        status: {
          type: String,
          enum: ['pending', 'in_progress', 'completed', 'cancelled'],
          default: 'pending'
        },
        notes: String,
        startedAt: Date,
        completedAt: Date,
        priority: {
          type: String,
          enum: ['low', 'medium', 'high', 'urgent'],
          default: 'medium'
        }
      }]
    },
    evening: {
      status: {
        type: String,
        enum: ['pending', 'in_progress', 'completed', 'cancelled'],
        default: 'pending'
      },
      description: {
        type: String,
        default: ''
      },
      startTime: {
        type: Date,
        default: null
      },
      endTime: {
        type: Date,
        default: null
      },
      timeWindow: {
        start: {
          type: String,
          default: '17:00'
        },
        end: {
          type: String,
          default: '20:00'
        }
      },
      priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'medium'
      },
      tags: [String],
      attachments: [{
        name: String,
        url: String,
        uploadedAt: {
          type: Date,
          default: Date.now
        }
      }],
      comments: [{
        text: String,
        author: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        },
        createdAt: {
          type: Date,
          default: Date.now
        }
      }],
      completionPercentage: {
        type: Number,
        min: 0,
        max: 100,
        default: 0
      },
      blockers: [String],
      tasks: [{
        id: Number,
        title: String,
        description: String,
        status: {
          type: String,
          enum: ['pending', 'in_progress', 'completed', 'cancelled'],
          default: 'pending'
        },
        notes: String,
        startedAt: Date,
        completedAt: Date,
        priority: {
          type: String,
          enum: ['low', 'medium', 'high', 'urgent'],
          default: 'medium'
        }
      }]
    }
  },
  
  // Overall Task Information
  overallStatus: {
    type: String,
    enum: ['not_started', 'in_progress', 'partially_completed', 'completed', 'cancelled'],
    default: 'not_started'
  },
  
  // Compliance Metrics
  compliance: {
    percentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    slotsCompleted: {
      type: Number,
      min: 0,
      max: 3,
      default: 0
    },
    slotsTotal: {
      type: Number,
      default: 3
    },
    onTime: {
      type: Boolean,
      default: true
    },
    delayedSlots: {
      type: Number,
      min: 0,
      default: 0
    }
  },
  
  // Team Assignment (for managers)
  teamAssignment: {
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    assignedAt: {
      type: Date,
      default: null
    },
    teamMembers: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }]
  },
  
  // Review and Approval
  review: {
    isRequired: {
      type: Boolean,
      default: false
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    reviewedAt: {
      type: Date,
      default: null
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'needs_revision'],
      default: 'pending'
    },
    feedback: {
      type: String,
      default: ''
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      default: null
    }
  },
  
  // Notifications
  notifications: {
    remindersSent: {
      type: Number,
      default: 0
    },
    lastReminderAt: {
      type: Date,
      default: null
    },
    escalated: {
      type: Boolean,
      default: false
    },
    escalatedAt: {
      type: Date,
      default: null
    },
    escalatedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  
  // System Information
  syncStatus: {
    type: String,
    enum: ['synced', 'pending', 'failed'],
    default: 'synced'
  },
  lastSyncAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for formatted date
taskSchema.virtual('formattedDate').get(function() {
  return this.date.toISOString().split('T')[0];
});

// Virtual for completed slots count
taskSchema.virtual('completedSlotsCount').get(function() {
  let count = 0;
  ['morning', 'afternoon', 'evening'].forEach(slot => {
    if (this.slots[slot]?.status === 'completed') count++;
  });
  return count;
});

// Index for better query performance
taskSchema.index({ userId: 1, date: 1 });
taskSchema.index({ overallStatus: 1 });
taskSchema.index({ 'compliance.percentage': 1 });

// Pre-save middleware to calculate compliance
taskSchema.pre('save', function(next) {
  this.calculateCompliance();
  next();
});

// Instance method to calculate compliance metrics
taskSchema.methods.calculateCompliance = function() {
  const slots = ['morning', 'afternoon', 'evening'];
  let completedSlots = 0;
  let delayedSlots = 0;
  let hasInProgress = false;
  
  slots.forEach(slotName => {
    const slot = this.slots[slotName];
    if (slot?.status === 'completed') {
      completedSlots++;
    } else if (slot?.status === 'in_progress') {
      hasInProgress = true;
    }
    
    // Check if slot is delayed (completed after time window)
    if (slot?.endTime && slot?.timeWindow?.end) {
      const endTimeHour = new Date(slot.endTime).getHours();
      const windowEndHour = parseInt(slot.timeWindow.end.split(':')[0]);
      if (endTimeHour > windowEndHour) {
        delayedSlots++;
      }
    }
  });
  
  // Update compliance metrics
  this.compliance.slotsCompleted = completedSlots;
  this.compliance.percentage = Math.round((completedSlots / 3) * 100);
  this.compliance.delayedSlots = delayedSlots;
  this.compliance.onTime = delayedSlots === 0;
  
  // Update overall status
  if (completedSlots === 0) {
    this.overallStatus = hasInProgress ? 'in_progress' : 'not_started';
  } else if (completedSlots === 3) {
    this.overallStatus = 'completed';
  } else {
    this.overallStatus = hasInProgress ? 'in_progress' : 'partially_completed';
  }
};

// Instance method to update slot status
taskSchema.methods.updateSlot = function(slotName, updates) {
  if (!['morning', 'afternoon', 'evening'].includes(slotName)) {
    throw new Error('Invalid slot name');
  }
  
  Object.assign(this.slots[slotName], updates);
  
  if (updates.status === 'completed' && !this.slots[slotName].endTime) {
    this.slots[slotName].endTime = new Date();
  }
  
  if (updates.status === 'in_progress' && !this.slots[slotName].startTime) {
    this.slots[slotName].startTime = new Date();
  }
  
  return this.save();
};

// Static method to get compliance summary for a user
taskSchema.statics.getComplianceSummary = async function(userId, startDate, endDate) {
  const records = await this.find({
    userId: userId,
    date: {
      $gte: startDate,
      $lte: endDate
    }
  });

  if (records.length === 0) {
    return {
      totalDays: 0,
      avgCompliance: 0,
      totalSlotsCompleted: 0,
      totalSlotsAvailable: 0,
      onTimeDays: 0,
      fullyCompletedDays: 0
    };
  }

  const summary = {
    totalDays: records.length,
    avgCompliance: records.reduce((sum, r) => sum + r.compliance.percentage, 0) / records.length,
    totalSlotsCompleted: records.reduce((sum, r) => sum + r.compliance.slotsCompleted, 0),
    totalSlotsAvailable: records.reduce((sum, r) => sum + r.compliance.slotsTotal, 0),
    onTimeDays: records.filter(r => r.compliance.onTime).length,
    fullyCompletedDays: records.filter(r => r.overallStatus === 'completed').length
  };

  return summary;
};

// Static method to get team compliance
taskSchema.statics.getTeamCompliance = async function(managerUserId, date) {
  const records = await this.find({ date: new Date(date) }).populate('userId', 'role');
  
  // Group by user role
  const roleGroups = {};
  
  records.forEach(record => {
    const role = record.userId?.role || 'employee';
    
    if (!roleGroups[role]) {
      roleGroups[role] = {
        _id: role,
        avgCompliance: 0,
        totalMembers: 0,
        completedTasks: 0,
        records: []
      };
    }
    
    roleGroups[role].records.push(record);
  });
  
  // Calculate averages
  return Object.values(roleGroups).map(group => {
    group.totalMembers = group.records.length;
    group.avgCompliance = group.records.reduce((sum, r) => sum + r.compliance.percentage, 0) / group.totalMembers;
    group.completedTasks = group.records.filter(r => r.overallStatus === 'completed').length;
    delete group.records;
    return group;
  });
};

// Create the model
const Task = mongoose.model('Task', taskSchema);

module.exports = Task;