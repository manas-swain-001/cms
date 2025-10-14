const jwt = require('jsonwebtoken');
const { User } = require('../models/User');

// Authentication middleware
const auth = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided, authorization denied'
      });
    }

    // Extract token
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No token provided, authorization denied'
      });
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Get user from in-memory store
      const user = await User.findById(decoded.id).lean();
      
      if (user) {
        // Exclude sensitive fields
        const { password, refreshTokens, biometricData, ...safeUser } = user;
        const userCopy = { ...safeUser };
        if (biometricData) {
          userCopy.biometricData = { ...biometricData };
          delete userCopy.biometricData.faceEncoding;
          delete userCopy.biometricData.fingerprintHash;
        }
        req.user = userCopy;
      } else {
        req.user = null;
      }

      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Token is not valid - user not found'
        });
      }

      if (!req.user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Account is deactivated'
        });
      }
      req.token = token;
      
      next();
    } catch (tokenError) {
      if (tokenError.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token has expired',
          code: 'TOKEN_EXPIRED'
        });
      }
      
      if (tokenError.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          message: 'Invalid token',
          code: 'INVALID_TOKEN'
        });
      }
      
      throw tokenError;
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error in authentication'
    });
  }
};

// Role-based authorization middleware
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required roles: ${roles.join(', ')}. Your role: ${req.user.role}`
      });
    }

    next();
  };
};

// Permission-based authorization middleware
const checkPermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!req.user.permissions.includes(permission)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required permission: ${permission}`
      });
    }

    next();
  };
};

// Office-based authorization middleware
const checkOfficeAccess = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  // Admin can access all offices
  if (req.user.role === 'admin') {
    return next();
  }

  // Check if user is trying to access data from their office
  const requestedOffice = req.params.office || req.query.office || req.body.office;
  
  if (requestedOffice && requestedOffice !== req.user.office) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. You can only access data from your office.'
    });
  }

  next();
};

// Self or admin access middleware (for user profile operations)
const selfOrAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  const targetUserId = req.params.userId || req.params.id;
  
  // Allow if admin or accessing own data
  if (req.user.role === 'admin' || req.user._id.toString() === targetUserId) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'Access denied. You can only access your own data.'
  });
};

// Manager access middleware (manager can access their team members)
const managerAccess = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Admin has full access
    if (req.user.role === 'admin') {
      return next();
    }

    // Manager can access their team
    if (req.user.role === 'manager') {
      const targetUserId = req.params.userId || req.params.id;
      
      if (targetUserId) {
        const targetUser = User.findById(targetUserId);
        
        if (!targetUser) {
          return res.status(404).json({
            success: false,
            message: 'User not found'
          });
        }

        // Check if target user is in same office and department
        if (targetUser.office === req.user.office && 
            targetUser.department === req.user.department) {
          return next();
        }
      }
    }

    // Self access
    const targetUserId = req.params.userId || req.params.id;
    if (req.user._id.toString() === targetUserId) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: 'Access denied. Insufficient permissions.'
    });
  } catch (error) {
    console.error('Manager access middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error in authorization'
    });
  }
};

// Optional authentication middleware (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(); // Continue without authentication
    }

    const token = authHeader.substring(7);
    
    if (!token) {
      return next(); // Continue without authentication
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = User.findById(decoded.id);
      
      if (user && user.isActive) {
        // Exclude sensitive fields
        const { password, refreshTokens, biometricData, ...safeUser } = user;
        const userCopy = { ...safeUser };
        if (biometricData) {
          userCopy.biometricData = { ...biometricData };
          delete userCopy.biometricData.faceEncoding;
          delete userCopy.biometricData.fingerprintHash;
        }
        req.user = userCopy;
        req.token = token;
      }
    } catch (tokenError) {
      // Ignore token errors in optional auth
    }
    
    next();
  } catch (error) {
    console.error('Optional auth middleware error:', error);
    next(); // Continue even if there's an error
  }
};

// Rate limiting for sensitive operations
const sensitiveOpRateLimit = (req, res, next) => {
  // This would typically use Redis or in-memory store
  // For now, just pass through
  next();
};

// Audit log middleware
const auditLog = (action) => {
  return (req, res, next) => {
    // Log the action
    const logData = {
      userId: req.user ? req.user._id : null,
      action,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date(),
      route: req.originalUrl,
      method: req.method
    };
    
    // TODO: Save to audit log collection
    console.log('Audit Log:', logData);
    
    next();
  };
};

module.exports = {
  auth,
  authorize,
  checkPermission,
  checkOfficeAccess,
  selfOrAdmin,
  managerAccess,
  optionalAuth,
  sensitiveOpRateLimit,
  auditLog
};