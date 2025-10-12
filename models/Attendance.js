const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
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
  
  // Check-in Information
  checkIn: {
    time: {
      type: Date,
      default: null
    },
    location: {
      latitude: {
        type: Number,
        default: null
      },
      longitude: {
        type: Number,
        default: null
      },
      address: {
        type: String,
        default: ''
      },
      accuracy: {
        type: Number,
        default: 0
      }
    },
    office: {
      type: String,
      default: null
    },
    method: {
      type: String,
      enum: ['manual', 'biometric', 'qr_code', 'gps'],
      default: 'manual'
    },
    deviceInfo: {
      userAgent: {
        type: String,
        default: ''
      },
      ipAddress: {
        type: String,
        default: ''
      },
      deviceId: {
        type: String,
        default: ''
      }
    },
    photo: {
      type: String,
      default: null
    },
    isLate: {
      type: Boolean,
      default: false
    },
    lateMinutes: {
      type: Number,
      default: 0
    }
  },
  
  // Check-out Information
  checkOut: {
    time: {
      type: Date,
      default: null
    },
    location: {
      latitude: {
        type: Number,
        default: null
      },
      longitude: {
        type: Number,
        default: null
      },
      address: {
        type: String,
        default: ''
      },
      accuracy: {
        type: Number,
        default: 0
      }
    },
    method: {
      type: String,
      enum: ['manual', 'biometric', 'qr_code', 'gps'],
      default: 'manual'
    },
    deviceInfo: {
      userAgent: {
        type: String,
        default: ''
      },
      ipAddress: {
        type: String,
        default: ''
      },
      deviceId: {
        type: String,
        default: ''
      }
    },
    photo: {
      type: String,
      default: null
    },
    isEarly: {
      type: Boolean,
      default: false
    },
    earlyMinutes: {
      type: Number,
      default: 0
    }
  },
  
  // Break Information
  breaks: [{
    startTime: {
      type: Date,
      required: true
    },
    endTime: {
      type: Date,
      default: null
    },
    duration: {
      type: Number,
      default: 0
    },
    type: {
      type: String,
      enum: ['lunch', 'tea', 'personal', 'meeting'],
      default: 'lunch'
    },
    location: {
      latitude: Number,
      longitude: Number,
      address: String
    },
    notes: String
  }],
  
  // Work Summary
  workSummary: {
    totalHours: {
      type: Number,
      default: 0
    },
    totalBreakTime: {
      type: Number,
      default: 0
    },
    effectiveHours: {
      type: Number,
      default: 0
    },
    overtime: {
      type: Number,
      default: 0
    },
    undertime: {
      type: Number,
      default: 0
    }
  },
  
  // Status and Validation
  status: {
    type: String,
    enum: ['present', 'absent', 'late', 'half_day', 'work_from_home'],
    default: 'present'
  },
  isValidated: {
    type: Boolean,
    default: false
  },
  validatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  validatedAt: {
    type: Date,
    default: null
  },
  
  // GPS Validation
  gpsValidation: {
    isValid: {
      type: Boolean,
      default: true
    },
    distanceFromOffice: {
      type: Number,
      default: 0
    },
    withinRadius: {
      type: Boolean,
      default: true
    }
  },
  
  // Notes and Comments
  notes: {
    type: String,
    default: ''
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
  },
  
  // Anomaly Detection
  anomalies: [{
    type: {
      type: String,
      enum: ['unusual_location', 'time_mismatch', 'device_change', 'duplicate_entry'],
      required: true
    },
    description: String,
    severity: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'low'
    },
    detectedAt: {
      type: Date,
      default: Date.now
    },
    resolved: {
      type: Boolean,
      default: false
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    resolvedAt: Date
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for formatted date
attendanceSchema.virtual('formattedDate').get(function() {
  return this.date.toISOString().split('T')[0];
});

// Virtual for work duration
attendanceSchema.virtual('workDuration').get(function() {
  if (!this.checkIn?.time || !this.checkOut?.time) return 0;
  return Math.round((this.checkOut.time - this.checkIn.time) / (1000 * 60 * 60 * 100)) / 100;
});

// Virtual for total break duration
attendanceSchema.virtual('totalBreakDuration').get(function() {
  return this.breaks.reduce((total, breakItem) => {
    if (breakItem.endTime) {
      return total + Math.round((breakItem.endTime - breakItem.startTime) / (1000 * 60));
    }
    return total;
  }, 0);
});

// Index for better query performance
attendanceSchema.index({ userId: 1, date: 1 });
attendanceSchema.index({ status: 1 });
attendanceSchema.index({ 'checkIn.office': 1 });

// Pre-save middleware to calculate work summary
attendanceSchema.pre('save', function(next) {
  this.calculateWorkSummary();
  next();
});

// Instance method to calculate work summary
attendanceSchema.methods.calculateWorkSummary = function() {
  if (this.checkIn?.time && this.checkOut?.time) {
    const totalMinutes = Math.round((this.checkOut.time - this.checkIn.time) / (1000 * 60));
    const totalBreakMinutes = this.totalBreakDuration;
    
    this.workSummary.totalHours = Math.round((totalMinutes / 60) * 100) / 100;
    this.workSummary.totalBreakTime = totalBreakMinutes;
    this.workSummary.effectiveHours = Math.round(((totalMinutes - totalBreakMinutes) / 60) * 100) / 100;
    
    // Calculate overtime/undertime (assuming 8 hours standard)
    const standardHours = 8;
    const difference = this.workSummary.effectiveHours - standardHours;
    
    if (difference > 0) {
      this.workSummary.overtime = Math.round(difference * 100) / 100;
      this.workSummary.undertime = 0;
    } else {
      this.workSummary.overtime = 0;
      this.workSummary.undertime = Math.round(Math.abs(difference) * 100) / 100;
    }
  }
};

// Static method to get attendance summary for a user
attendanceSchema.statics.getAttendanceSummary = async function(userId, startDate, endDate) {
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
      presentDays: 0,
      lateDays: 0,
      totalHours: 0,
      totalOvertime: 0,
      avgCheckInTime: null,
      avgCheckOutTime: null
    };
  }

  const summary = {
    totalDays: records.length,
    presentDays: records.filter(r => r.status === 'present').length,
    lateDays: records.filter(r => r.checkIn?.isLate).length,
    totalHours: records.reduce((sum, r) => sum + (r.workSummary?.totalHours || 0), 0),
    totalOvertime: records.reduce((sum, r) => sum + (r.workSummary?.overtime || 0), 0),
    avgCheckInTime: null,
    avgCheckOutTime: null
  };

  // Calculate average check-in and check-out times
  const checkInTimes = records.filter(r => r.checkIn?.time).map(r => r.checkIn.time.getTime());
  const checkOutTimes = records.filter(r => r.checkOut?.time).map(r => r.checkOut.time.getTime());

  if (checkInTimes.length > 0) {
    summary.avgCheckInTime = new Date(checkInTimes.reduce((sum, time) => sum + time, 0) / checkInTimes.length);
  }

  if (checkOutTimes.length > 0) {
    summary.avgCheckOutTime = new Date(checkOutTimes.reduce((sum, time) => sum + time, 0) / checkOutTimes.length);
  }

  return summary;
};

// Static method to get office-wise attendance
attendanceSchema.statics.getOfficeAttendance = async function(date, office = null) {
  const query = { date: new Date(date) };
  if (office) {
    query['checkIn.office'] = office;
  }

  const records = await this.find(query);
  const officeGroups = {};

  records.forEach(record => {
    const officeKey = record.checkIn?.office || 'unknown';
    if (!officeGroups[officeKey]) {
      officeGroups[officeKey] = {
        _id: officeKey,
        totalEmployees: 0,
        presentCount: 0,
        lateCount: 0,
        checkInTimes: []
      };
    }

    officeGroups[officeKey].totalEmployees++;
    if (record.status === 'present') {
      officeGroups[officeKey].presentCount++;
    }
    if (record.checkIn?.isLate) {
      officeGroups[officeKey].lateCount++;
    }
    if (record.checkIn?.time) {
      officeGroups[officeKey].checkInTimes.push(record.checkIn.time.getTime());
    }
  });

  // Calculate average check-in times
  return Object.values(officeGroups).map(group => {
    if (group.checkInTimes.length > 0) {
      group.avgCheckInTime = new Date(
        group.checkInTimes.reduce((sum, time) => sum + time, 0) / group.checkInTimes.length
      );
    } else {
      group.avgCheckInTime = null;
    }
    delete group.checkInTimes;
    return group;
  });
};

// Create the model
const Attendance = mongoose.model('Attendance', attendanceSchema);

module.exports = Attendance;