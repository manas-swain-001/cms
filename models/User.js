const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const userSchema = new mongoose.Schema({
  // Basic Information
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    maxlength: [50, 'First name cannot exceed 50 characters']
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
    maxlength: [50, 'Last name cannot exceed 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false
  },
  
  // Role and Permissions
  role: {
    type: String,
    enum: ['admin', 'manager', 'developer', 'employee'],
    default: 'developer'
  },
  permissions: [{
    type: String,
    enum: ['read', 'write', 'delete', 'admin', 'manage_users', 'view_reports', 'manage_attendance', 'manage_tasks']
  }],
  
  // Office and Location
  office: {
    type: String,
    required: [true, 'Office is required'],
    trim: true
  },
  department: {
    type: String,
    trim: true
  },
  employeeId: {
    type: String,
    sparse: true
  },
  
  // Contact Information
  phone: {
    type: String,
    trim: true,
    match: [/^[\+]?[1-9][\d]{0,15}$/, 'Please enter a valid phone number']
  },
  address: {
    street: String,
    city: String,
    state: String,
    country: String,
    zipCode: String
  },
  
  // Profile Information
  avatar: {
    type: String,
    default: null
  },
  dateOfBirth: {
    type: Date
  },
  joiningDate: {
    type: Date,
    default: Date.now
  },
  
  // Biometric Data
  biometricData: {
    faceEncoding: {
      type: String,
      default: null
    },
    fingerprintHash: {
      type: String,
      default: null
    },
    isEnrolled: {
      type: Boolean,
      default: false
    },
    enrolledAt: {
      type: Date,
      default: null
    }
  },
  
  // Preferences
  preferences: {
    theme: {
      type: String,
      enum: ['light', 'dark', 'system'],
      default: 'system'
    },
    language: {
      type: String,
      default: 'en'
    },
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      push: {
        type: Boolean,
        default: true
      },
      sms: {
        type: Boolean,
        default: false
      }
    },
    timezone: {
      type: String,
      default: 'Asia/Kolkata'
    }
  },
  
  // Work Schedule
  workSchedule: {
    shiftType: {
      type: String,
      enum: ['morning', 'afternoon', 'evening', 'night'],
      default: 'morning'
    },
    workingHours: {
      start: {
        type: String,
        default: '09:00'
      },
      end: {
        type: String,
        default: '18:00'
      }
    },
    workingDays: [{
      type: String,
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      default: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
    }]
  },
  
  // Account Status
  isActive: {
    type: Boolean,
    default: true
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  lastLogin: {
    type: Date
  },
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date
  },
  
  // Refresh Tokens
  refreshTokens: [{
    token: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Password Reset
  passwordResetToken: String,
  passwordResetExpires: Date,
  
  // Email Verification
  emailVerificationToken: String,
  emailVerificationExpires: Date
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual for account locked status
userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Index for better query performance
userSchema.index({ email: 1 });
userSchema.index({ employeeId: 1 });
userSchema.index({ office: 1 });
userSchema.index({ role: 1 });

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
  // Only hash the password if it has been modified (or is new)
  if (!this.isModified('password')) return next();
  
  try {
    // Hash password with cost of 12
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
    this.password = await bcrypt.hash(this.password, saltRounds);
    next();
  } catch (error) {
    next(error);
  }
});

// Pre-save middleware to generate employee ID
userSchema.pre('save', async function(next) {
  if (this.isNew && !this.employeeId) {
    try {
      const count = await this.constructor.countDocuments({ office: this.office });
      const officeCode = this.office.substring(0, 3).toUpperCase();
      this.employeeId = `${officeCode}${String(count + 1).padStart(4, '0')}`;
      next();
    } catch (error) {
      next(error);
    }
  } else {
    next();
  }
});

// Instance method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Instance method to generate JWT token
userSchema.methods.generateAuthToken = function() {
  const payload = {
    id: this._id,
    email: this.email,
    role: this.role,
    office: this.office
  };
  
  return jwt.sign(payload, process.env.JWT_SECRET || 'fallback-secret', {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};

// Instance method to generate refresh token
userSchema.methods.generateRefreshToken = function() {
  const payload = {
    id: this._id,
    type: 'refresh'
  };
  
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET || 'fallback-refresh-secret', {
    expiresIn: process.env.JWT_REFRESH_EXPIRE || '30d'
  });
};

// Instance method to increment login attempts
userSchema.methods.incLoginAttempts = function() {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    this.lockUntil = null;
    this.loginAttempts = 1;
  } else {
    this.loginAttempts += 1;
    
    if (this.loginAttempts >= 5 && !this.isLocked) {
      this.lockUntil = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours
    }
  }
  
  return this.save();
};

// Instance method to reset login attempts
userSchema.methods.resetLoginAttempts = function() {
  this.loginAttempts = 0;
  this.lockUntil = null;
  return this.save();
};

// Static method to find user by credentials
userSchema.statics.findByCredentials = async function(email, password) {
  const user = await this.findOne({ email, isActive: true }).select('+password');
  
  if (!user) {
    throw new Error('Invalid credentials');
  }
  
  if (user.isLocked) {
    throw new Error('Account is temporarily locked due to too many failed login attempts');
  }
  
  const isMatch = await user.comparePassword(password);
  
  if (!isMatch) {
    await user.incLoginAttempts();
    throw new Error('Invalid credentials');
  }
  
  if (user.loginAttempts > 0) {
    await user.resetLoginAttempts();
  }
  
  // Update last login
  user.lastLogin = new Date();
  await user.save();
  
  return user;
};

// Create the model
const User = mongoose.model('User', userSchema);

// Initialize with a default admin user if no users exist
// This will be called after the database connection is established
const initializeDefaultUser = async () => {
  try {
    const count = await User.countDocuments();
    if (count === 0) {
      await User.create({
        firstName: 'Admin',
        lastName: 'User',
        email: 'admin@smartxalgo.com',
        password: 'admin123',
        role: 'admin',
        office: 'bhubaneswar',
        permissions: ['read', 'write', 'delete', 'admin', 'manage_users', 'view_reports'],
        isEmailVerified: true
      });
      console.log('✅ Default admin user created: admin@smartxalgo.com / admin123');
    }
  } catch (err) {
    console.error('❌ Error creating default admin user:', err.message);
  }
};

// Export the initialization function
module.exports = { User, initializeDefaultUser };