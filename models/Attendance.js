const mongoose = require('mongoose');
const { ATTENDANCE_STATUS, WORK_LOCATION, ATTENDANCE_BREAK_TYPE, ATTENDANCE_METHOD } = require('../constant/enum');

const sessionSchema = new mongoose.Schema({
  checkIn: {
    time: {
      type: Date,
      required: true,
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
      enum: Object.values(ATTENDANCE_METHOD),
      default: ATTENDANCE_METHOD.MANUAL
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
    },
    gpsValidation: {
      distanceFromOffice: {
        type: String,
        default: '0 m'
      },
      withinRadius: {
        type: Boolean,
        default: true
      }
    }
  },
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
      accuracy: {
        type: Number,
        default: 0
      }
    },
    method: {
      type: String,
      enum: Object.values(ATTENDANCE_METHOD),
      default: ATTENDANCE_METHOD.MANUAL
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
    },
    gpsValidation: {
      distanceFromOffice: {
        type: String,
        default: '0 m'
      },
      withinRadius: {
        type: Boolean,
        default: true
      }
    }
  }
});

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

  // Check-in/Check-out Information
  sessions: [sessionSchema],
  
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
      enum: Object.values(ATTENDANCE_BREAK_TYPE),
      default: ATTENDANCE_BREAK_TYPE.LUNCH
    },
    location: {
      latitude: Number,
      longitude: Number,
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
    enum: Object.values(ATTENDANCE_STATUS),
    default: ATTENDANCE_STATUS.PRESENT
  },
  workLocation: {
    type: String,
    enum: Object.values(WORK_LOCATION),
    default: WORK_LOCATION.OFFICE
  },
  // Notes and Comments
  notes: {
    type: String,
    default: ''
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for formatted date
attendanceSchema.virtual('formattedDate').get(function () {
  return this.date.toISOString().split('T')[0];
});

// Virtual for work duration
attendanceSchema.virtual('workDuration').get(function () {
  if (!this.sessions || this.sessions.length === 0) return 0;
  
  let totalDuration = 0;
  this.sessions.forEach(session => {
    if (session.checkIn?.time && session.checkOut?.time) {
      totalDuration += (session.checkOut.time - session.checkIn.time);
    }
  });
  
  return Math.round((totalDuration / (1000 * 60 * 60)) * 100) / 100; // Convert to hours
});

// Virtual for total break duration
attendanceSchema.virtual('totalBreakDuration').get(function () {
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
attendanceSchema.index({ 'sessions.checkIn.office': 1 });

// Pre-save middleware to calculate work summary
attendanceSchema.pre('save', function (next) {
  this.calculateWorkSummary();
  next();
});

// Instance method to calculate work summary
attendanceSchema.methods.calculateWorkSummary = function () {
  if (!this.sessions || this.sessions.length === 0) {
    this.workSummary = {
      totalHours: 0,
      totalBreakTime: 0,
      effectiveHours: 0,
      overtime: 0,
      undertime: 0
    };
    return;
  }

  // Calculate total work time from all sessions
  let totalWorkMinutes = 0;
  this.sessions.forEach(session => {
    if (session.checkIn?.time && session.checkOut?.time) {
      totalWorkMinutes += Math.round((session.checkOut.time - session.checkIn.time) / (1000 * 60));
    }
  });

  const totalBreakMinutes = this.totalBreakDuration;

  this.workSummary.totalHours = Math.round((totalWorkMinutes / 60) * 100) / 100;
  this.workSummary.totalBreakTime = totalBreakMinutes;
  this.workSummary.effectiveHours = Math.round(((totalWorkMinutes - totalBreakMinutes) / 60) * 100) / 100;

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
};

// Static method to get attendance summary for a user
attendanceSchema.statics.getAttendanceSummary = async function (userId, startDate, endDate) {
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
    lateDays: records.filter(r => r.sessions?.some(s => s.checkIn?.isLate)).length,
    totalHours: records.reduce((sum, r) => sum + (r.workSummary?.totalHours || 0), 0),
    totalOvertime: records.reduce((sum, r) => sum + (r.workSummary?.overtime || 0), 0),
    avgCheckInTime: null,
    avgCheckOutTime: null
  };

  // Calculate average check-in and check-out times from all sessions
  const checkInTimes = [];
  const checkOutTimes = [];
  
  records.forEach(record => {
    if (record.sessions) {
      record.sessions.forEach(session => {
        if (session.checkIn?.time) {
          checkInTimes.push(session.checkIn.time.getTime());
        }
        if (session.checkOut?.time) {
          checkOutTimes.push(session.checkOut.time.getTime());
        }
      });
    }
  });

  if (checkInTimes.length > 0) {
    summary.avgCheckInTime = new Date(checkInTimes.reduce((sum, time) => sum + time, 0) / checkInTimes.length);
  }

  if (checkOutTimes.length > 0) {
    summary.avgCheckOutTime = new Date(checkOutTimes.reduce((sum, time) => sum + time, 0) / checkOutTimes.length);
  }

  return summary;
};

// Static method to get office-wise attendance
attendanceSchema.statics.getOfficeAttendance = async function (date, office = null) {
  const query = { date: new Date(date) };
  if (office) {
    query['checkIn.office'] = office;
  }

  const records = await this.find(query);
  const officeGroups = {};

  records.forEach(record => {
    // Get office from first session's check-in
    const firstSession = record.sessions?.[0];
    const officeKey = firstSession?.checkIn?.office || 'unknown';
    
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
    
    // Check if any session has late check-in
    if (record.sessions?.some(s => s.checkIn?.isLate)) {
      officeGroups[officeKey].lateCount++;
    }
    
    // Collect all check-in times from all sessions
    if (record.sessions) {
      record.sessions.forEach(session => {
        if (session.checkIn?.time) {
          officeGroups[officeKey].checkInTimes.push(session.checkIn.time.getTime());
        }
      });
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

// Instance method to get active session
attendanceSchema.methods.getActiveSession = function() {
  return this.sessions?.find(session => 
    session.checkIn?.time && !session.checkOut?.time
  ) || null;
};

// Instance method to get completed sessions
attendanceSchema.methods.getCompletedSessions = function() {
  return this.sessions?.filter(session => 
    session.checkIn?.time && session.checkOut?.time
  ) || [];
};

// Instance method to check if user is currently working
attendanceSchema.methods.isCurrentlyWorking = function() {
  const activeSession = this.getActiveSession();
  const ongoingBreak = this.breaks?.find(b => b.startTime && !b.endTime);
  return activeSession && !ongoingBreak;
};

// Instance method to check if user is on break
attendanceSchema.methods.isOnBreak = function() {
  const activeSession = this.getActiveSession();
  const ongoingBreak = this.breaks?.find(b => b.startTime && !b.endTime);
  return activeSession && ongoingBreak;
};

// Instance method to get session summary
attendanceSchema.methods.getSessionSummary = function() {
  const sessions = this.sessions || [];
  return {
    totalSessions: sessions.length,
    completedSessions: this.getCompletedSessions().length,
    activeSessions: sessions.filter(s => s.checkIn?.time && !s.checkOut?.time).length,
    firstCheckIn: sessions[0]?.checkIn?.time || null,
    lastCheckOut: sessions.slice().reverse().find(s => s.checkOut?.time)?.checkOut?.time || null,
    totalWorkTime: this.workSummary?.totalHours || 0,
    totalBreakTime: this.workSummary?.totalBreakTime || 0,
    effectiveWorkTime: this.workSummary?.effectiveHours || 0
  };
};

// Static method to get attendance statistics for a date range
attendanceSchema.statics.getAttendanceStats = async function(userId, startDate, endDate) {
  const records = await this.find({
    userId,
    date: { $gte: startDate, $lte: endDate }
  });

  const stats = {
    totalDays: records.length,
    presentDays: records.filter(r => r.status === 'present').length,
    partialDays: records.filter(r => r.status === 'partial').length,
    absentDays: records.filter(r => r.status === 'absent').length,
    totalSessions: records.reduce((sum, r) => sum + (r.sessions?.length || 0), 0),
    totalWorkHours: records.reduce((sum, r) => sum + (r.workSummary?.totalHours || 0), 0),
    totalBreakHours: records.reduce((sum, r) => sum + (r.workSummary?.totalBreakTime || 0), 0),
    totalEffectiveHours: records.reduce((sum, r) => sum + (r.workSummary?.effectiveHours || 0), 0),
    averageWorkHours: 0,
    averageSessionsPerDay: 0
  };

  if (stats.totalDays > 0) {
    stats.averageWorkHours = Math.round((stats.totalWorkHours / stats.totalDays) * 100) / 100;
    stats.averageSessionsPerDay = Math.round((stats.totalSessions / stats.totalDays) * 100) / 100;
  }

  return stats;
};

// Create the model
const Attendance = mongoose.model('Attendance', attendanceSchema);

module.exports = Attendance;