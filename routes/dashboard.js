const express = require('express');
const { query, validationResult } = require('express-validator');
const { User } = require('../models/User');
const Attendance = require('../models/Attendance');
const { Task } = require('../models/Task');
const { auth, authorize } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/dashboard/overview
// @desc    Get dashboard overview data
// @access  Private
router.get('/overview', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

    // Get today's attendance
    const todayAttendance = await Attendance.findOne({
      userId,
      date: today
    });

    // Get today's tasks
    const todayTasks = await Task.findOne({
      userId,
      date: today
    });

    // Get weekly stats
    const weeklyAttendance = await Attendance.find({
      userId,
      date: { $gte: startOfWeek, $lte: today }
    });
    
    const weeklyTasks = await Task.find({
      userId,
      date: { $gte: startOfWeek, $lte: today }
    });

    // Calculate metrics
    const overview = {
      today: {
        attendance: {
          status: todayAttendance ? todayAttendance.status : 'absent',
          punchIn: todayAttendance?.punchIn?.time || null,
          punchOut: todayAttendance?.punchOut?.time || null,
          workingHours: todayAttendance?.workSummary?.totalHours || 0,
          breakTime: todayAttendance?.workSummary?.breakTime || 0
        },
        tasks: {
          complianceScore: todayTasks?.complianceMetrics?.overallScore || 0,
          completedTasks: todayTasks?.complianceMetrics?.completedTasks || 0,
          totalTasks: todayTasks?.complianceMetrics?.totalTasks || 15,
          status: todayTasks?.overallStatus || 'not_started'
        }
      },
      weekly: {
        attendance: {
          daysPresent: weeklyAttendance.filter(a => a.status === 'present').length,
          daysPartial: weeklyAttendance.filter(a => a.status === 'partial').length,
          totalWorkingHours: weeklyAttendance.reduce((sum, a) => sum + (a.workSummary?.totalHours || 0), 0),
          averageWorkingHours: weeklyAttendance.length > 0 ? 
            weeklyAttendance.reduce((sum, a) => sum + (a.workSummary?.totalHours || 0), 0) / weeklyAttendance.length : 0
        },
        tasks: {
          averageCompliance: weeklyTasks.length > 0 ? 
            weeklyTasks.reduce((sum, t) => sum + (t.complianceMetrics?.overallScore || 0), 0) / weeklyTasks.length : 0,
          totalTasksCompleted: weeklyTasks.reduce((sum, t) => sum + (t.complianceMetrics?.completedTasks || 0), 0),
          totalTasksAssigned: weeklyTasks.reduce((sum, t) => sum + (t.complianceMetrics?.totalTasks || 0), 0)
        }
      }
    };

    res.json({
      success: true,
      data: { overview }
    });
  } catch (error) {
    console.error('Get dashboard overview error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching dashboard overview'
    });
  }
});

// @route   GET /api/dashboard/team-overview
// @desc    Get team dashboard overview (for managers)
// @access  Private (Manager/Admin)
router.get('/team-overview', [auth, authorize('admin', 'manager')], async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Build filter based on user role
    const userFilter = {};
    if (req.user.role === 'manager') {
      userFilter.office = req.user.office;
      userFilter.department = req.user.department;
    }

    // Get team members
    const teamMembers = await User.find({
      ...userFilter,
      isActive: true,
      _id: { $ne: req.user._id }
    }).select('_id firstName lastName role');

    const teamIds = teamMembers.map(member => member._id);

    // Get today's team attendance and tasks
    const [teamAttendance, teamTasks] = await Promise.all([
      Attendance.find({
        userId: { $in: teamIds },
        date: today
      }).populate('userId', 'firstName lastName role'),
      Task.find({
        userId: { $in: teamIds },
        date: today
      }).populate('userId', 'firstName lastName role')
    ]);

    // Calculate team metrics
    const teamOverview = {
      teamSize: teamMembers.length,
      attendance: {
        present: teamAttendance.filter(a => a.status === 'present').length,
        partial: teamAttendance.filter(a => a.status === 'partial').length,
        absent: teamMembers.length - teamAttendance.length,
        late: teamAttendance.filter(a => {
          if (!a.punchIn) return false;
          const punchInTime = new Date(a.punchIn.time);
          const expectedTime = new Date(today);
          expectedTime.setHours(9, 0, 0, 0); // 9 AM expected
          return punchInTime > expectedTime;
        }).length
      },
      tasks: {
        averageCompliance: teamTasks.length > 0 ? 
          teamTasks.reduce((sum, t) => sum + (t.complianceMetrics?.overallScore || 0), 0) / teamTasks.length : 0,
        highPerformers: teamTasks.filter(t => (t.complianceMetrics?.overallScore || 0) >= 80).length,
        needsAttention: teamTasks.filter(t => (t.complianceMetrics?.overallScore || 0) < 50).length,
        totalTasksCompleted: teamTasks.reduce((sum, t) => sum + (t.complianceMetrics?.completedTasks || 0), 0)
      },
      recentActivity: {
        recentPunchIns: teamAttendance
          .filter(a => a.punchIn)
          .sort((a, b) => new Date(b.punchIn.time) - new Date(a.punchIn.time))
          .slice(0, 5)
          .map(a => ({
            user: a.userId,
            punchInTime: a.punchIn.time,
            location: a.punchIn.location?.address || 'Unknown'
          })),
        recentTaskUpdates: teamTasks
          .filter(t => t.updatedAt)
          .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
          .slice(0, 5)
          .map(t => ({
            user: t.userId,
            complianceScore: t.complianceMetrics?.overallScore || 0,
            lastUpdated: t.updatedAt
          }))
      }
    };

    res.json({
      success: true,
      data: { teamOverview }
    });
  } catch (error) {
    console.error('Get team overview error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching team overview'
    });
  }
});

// @route   GET /api/dashboard/attendance-widget
// @desc    Get attendance widget data
// @access  Private
router.get('/attendance-widget', [
  auth,
  query('period')
    .optional()
    .isIn(['week', 'month'])
    .withMessage('Period must be week or month')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { period = 'week' } = req.query;
    const userId = req.user._id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Calculate date range
    const startDate = new Date(today);
    if (period === 'week') {
      startDate.setDate(today.getDate() - 6); // Last 7 days
    } else {
      startDate.setDate(today.getDate() - 29); // Last 30 days
    }

    // Get attendance records
    const attendanceRecords = await Attendance.find({
      userId,
      date: { $gte: startDate, $lte: today }
    }).sort({ date: 1 });

    // Generate daily data
    const dailyData = [];
    const currentDate = new Date(startDate);
    
    while (currentDate <= today) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const attendance = attendanceRecords.find(a => 
        a.date.toISOString().split('T')[0] === dateStr
      );
      
      dailyData.push({
        date: dateStr,
        status: attendance ? attendance.status : 'absent',
        workingHours: attendance?.workSummary?.totalHours || 0,
        punchIn: attendance?.punchIn?.time || null,
        punchOut: attendance?.punchOut?.time || null
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Calculate summary
    const summary = {
      totalDays: dailyData.length,
      presentDays: dailyData.filter(d => d.status === 'present').length,
      partialDays: dailyData.filter(d => d.status === 'partial').length,
      absentDays: dailyData.filter(d => d.status === 'absent').length,
      totalWorkingHours: dailyData.reduce((sum, d) => sum + d.workingHours, 0),
      averageWorkingHours: dailyData.length > 0 ? 
        dailyData.reduce((sum, d) => sum + d.workingHours, 0) / dailyData.length : 0,
      attendanceRate: dailyData.length > 0 ? 
        ((dailyData.filter(d => d.status !== 'absent').length / dailyData.length) * 100).toFixed(1) : 0
    };

    res.json({
      success: true,
      data: {
        period,
        dailyData,
        summary
      }
    });
  } catch (error) {
    console.error('Get attendance widget error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching attendance widget data'
    });
  }
});

// @route   GET /api/dashboard/task-compliance-widget
// @desc    Get task compliance widget data
// @access  Private
router.get('/task-compliance-widget', [
  auth,
  query('period')
    .optional()
    .isIn(['week', 'month'])
    .withMessage('Period must be week or month')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { period = 'week' } = req.query;
    const userId = req.user._id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Calculate date range
    const startDate = new Date(today);
    if (period === 'week') {
      startDate.setDate(today.getDate() - 6);
    } else {
      startDate.setDate(today.getDate() - 29);
    }

    // Get task records
    const taskRecords = await Task.find({
      userId,
      date: { $gte: startDate, $lte: today }
    }).sort({ date: 1 });

    // Generate daily compliance data
    const dailyCompliance = [];
    const currentDate = new Date(startDate);
    
    while (currentDate <= today) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const task = taskRecords.find(t => 
        t.date.toISOString().split('T')[0] === dateStr
      );
      
      dailyCompliance.push({
        date: dateStr,
        complianceScore: task?.complianceMetrics?.overallScore || 0,
        completedTasks: task?.complianceMetrics?.completedTasks || 0,
        totalTasks: task?.complianceMetrics?.totalTasks || 15,
        morningCompliance: task?.morning?.completionRate || 0,
        afternoonCompliance: task?.afternoon?.completionRate || 0,
        eveningCompliance: task?.evening?.completionRate || 0
      });
      
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Calculate summary
    const summary = {
      averageCompliance: dailyCompliance.length > 0 ? 
        dailyCompliance.reduce((sum, d) => sum + d.complianceScore, 0) / dailyCompliance.length : 0,
      totalTasksCompleted: dailyCompliance.reduce((sum, d) => sum + d.completedTasks, 0),
      totalTasksAssigned: dailyCompliance.reduce((sum, d) => sum + d.totalTasks, 0),
      bestDay: dailyCompliance.reduce((best, current) => 
        current.complianceScore > best.complianceScore ? current : best, 
        { complianceScore: 0, date: null }
      ),
      trend: {
        improving: dailyCompliance.length >= 2 ? 
          dailyCompliance[dailyCompliance.length - 1].complianceScore > 
          dailyCompliance[dailyCompliance.length - 2].complianceScore : false
      }
    };

    res.json({
      success: true,
      data: {
        period,
        dailyCompliance,
        summary
      }
    });
  } catch (error) {
    console.error('Get task compliance widget error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching task compliance widget data'
    });
  }
});

// @route   GET /api/dashboard/system-health
// @desc    Get system health widget data
// @access  Private (Admin/Manager)
router.get('/system-health', [auth, authorize('admin', 'manager')], async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get system metrics
    const [totalUsers, activeUsers, todayAttendance, todayTasks] = await Promise.all([
      User.countDocuments({ isActive: true }),
      User.countDocuments({ isActive: true, lastLogin: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
      Attendance.countDocuments({ date: today }),
      Task.countDocuments({ date: today })
    ]);

    // Calculate health metrics
    const systemHealth = {
      userActivity: {
        status: activeUsers / totalUsers > 0.8 ? 'healthy' : activeUsers / totalUsers > 0.5 ? 'warning' : 'critical',
        activeUsers,
        totalUsers,
        activePercentage: totalUsers > 0 ? ((activeUsers / totalUsers) * 100).toFixed(1) : 0
      },
      attendanceSystem: {
        status: todayAttendance / totalUsers > 0.7 ? 'healthy' : todayAttendance / totalUsers > 0.4 ? 'warning' : 'critical',
        recordsToday: todayAttendance,
        expectedRecords: totalUsers,
        coveragePercentage: totalUsers > 0 ? ((todayAttendance / totalUsers) * 100).toFixed(1) : 0
      },
      taskSystem: {
        status: todayTasks / totalUsers > 0.6 ? 'healthy' : todayTasks / totalUsers > 0.3 ? 'warning' : 'critical',
        recordsToday: todayTasks,
        expectedRecords: totalUsers,
        coveragePercentage: totalUsers > 0 ? ((todayTasks / totalUsers) * 100).toFixed(1) : 0
      },
      database: {
        status: 'healthy', // This would be determined by actual DB health checks
        responseTime: Math.floor(Math.random() * 50) + 10, // Mock response time
        connections: Math.floor(Math.random() * 20) + 5 // Mock connection count
      },
      server: {
        status: 'healthy',
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage()
      }
    };

    // Overall system status
    const componentStatuses = [
      systemHealth.userActivity.status,
      systemHealth.attendanceSystem.status,
      systemHealth.taskSystem.status,
      systemHealth.database.status,
      systemHealth.server.status
    ];

    let overallStatus = 'healthy';
    if (componentStatuses.includes('critical')) {
      overallStatus = 'critical';
    } else if (componentStatuses.includes('warning')) {
      overallStatus = 'warning';
    }

    systemHealth.overall = {
      status: overallStatus,
      lastChecked: new Date()
    };

    res.json({
      success: true,
      data: { systemHealth }
    });
  } catch (error) {
    console.error('Get system health error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching system health data'
    });
  }
});

// @route   GET /api/dashboard/recent-activity
// @desc    Get recent activity feed
// @access  Private
router.get('/recent-activity', [
  auth,
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { limit = 20 } = req.query;
    const userId = req.user._id;
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Get recent attendance and task activities
    const [recentAttendance, recentTasks] = await Promise.all([
      Attendance.find({
        userId,
        updatedAt: { $gte: last24Hours }
      })
      .sort({ updatedAt: -1 })
      .limit(parseInt(limit) / 2)
      .lean(),
      Task.find({
        userId,
        updatedAt: { $gte: last24Hours }
      })
      .sort({ updatedAt: -1 })
      .limit(parseInt(limit) / 2)
      .lean()
    ]);

    // Format activities
    const activities = [];

    // Add attendance activities
    recentAttendance.forEach(attendance => {
      if (attendance.punchIn) {
        activities.push({
          type: 'attendance',
          action: 'punch_in',
          timestamp: attendance.punchIn.time,
          description: 'Punched in for work',
          location: attendance.punchIn.location?.address || 'Unknown location'
        });
      }
      
      if (attendance.punchOut) {
        activities.push({
          type: 'attendance',
          action: 'punch_out',
          timestamp: attendance.punchOut.time,
          description: 'Punched out from work',
          workingHours: attendance.workSummary?.totalHours || 0
        });
      }
    });

    // Add task activities
    recentTasks.forEach(task => {
      activities.push({
        type: 'task',
        action: 'compliance_update',
        timestamp: task.updatedAt,
        description: 'Updated task compliance',
        complianceScore: task.complianceMetrics?.overallScore || 0,
        completedTasks: task.complianceMetrics?.completedTasks || 0
      });
    });

    // Sort all activities by timestamp and limit
    activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const limitedActivities = activities.slice(0, parseInt(limit));

    res.json({
      success: true,
      data: {
        activities: limitedActivities,
        totalActivities: activities.length
      }
    });
  } catch (error) {
    console.error('Get recent activity error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching recent activity'
    });
  }
});

// @route   GET /api/dashboard/performance-metrics
// @desc    Get performance metrics for charts
// @access  Private
router.get('/performance-metrics', [
  auth,
  query('period')
    .optional()
    .isIn(['week', 'month', 'quarter'])
    .withMessage('Period must be week, month, or quarter')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { period = 'month' } = req.query;
    const userId = req.user._id;
    const endDate = new Date();
    const startDate = new Date();

    // Calculate date range
    switch (period) {
      case 'week':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(endDate.getMonth() - 1);
        break;
      case 'quarter':
        startDate.setMonth(endDate.getMonth() - 3);
        break;
    }
    
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    // Get performance data
    const [attendanceMetrics, taskMetrics] = await Promise.all([
      Attendance.aggregate([
        {
          $match: {
            userId,
            date: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: {
              week: { $week: '$date' },
              year: { $year: '$date' }
            },
            avgWorkingHours: { $avg: '$workSummary.totalHours' },
            totalDays: { $sum: 1 },
            presentDays: {
              $sum: {
                $cond: [{ $eq: ['$status', 'present'] }, 1, 0]
              }
            }
          }
        },
        { $sort: { '_id.year': 1, '_id.week': 1 } }
      ]),
      Task.aggregate([
        {
          $match: {
            userId,
            date: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: {
              week: { $week: '$date' },
              year: { $year: '$date' }
            },
            avgCompliance: { $avg: '$complianceMetrics.overallScore' },
            totalTasksCompleted: { $sum: '$complianceMetrics.completedTasks' },
            totalTasksAssigned: { $sum: '$complianceMetrics.totalTasks' }
          }
        },
        { $sort: { '_id.year': 1, '_id.week': 1 } }
      ])
    ]);

    res.json({
      success: true,
      data: {
        period,
        dateRange: { startDate, endDate },
        attendanceMetrics,
        taskMetrics
      }
    });
  } catch (error) {
    console.error('Get performance metrics error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching performance metrics'
    });
  }
});

module.exports = router;