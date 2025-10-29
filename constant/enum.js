const USER_ROLES = Object.freeze({
    ADMIN: 'admin',
    MANAGER: 'manager',
    EMPLOYEE: 'employee',
    SALES: 'sales',
    FIELD: 'field'
});

const PERMISSIONS = Object.freeze({
    READ: 'read',
    WRITE: 'write',
    DELETE: 'delete',
    ADMIN: 'admin',
    MANAGE_USERS: 'manage_users',
    VIEW_REPORTS: 'view_reports',
    MANAGE_ATTENDANCE: 'manage_attendance',
    MANAGE_TASKS: 'manage_tasks'
});

const ATTENDANCE_STATUS = Object.freeze({
    PRESENT: 'present',
    PARTIAL: 'partial'
});

const WORK_LOCATION = Object.freeze({
    OFFICE: 'office',
    HOME: 'home'
});
const ATTENDANCE_METHOD = Object.freeze({
    MANUAL: 'manual',
    BIOMETRIC: 'biometric',
    QR_CODE: 'qr_code',
    GPS: 'gps'
});
const ATTENDANCE_BREAK_TYPE = Object.freeze({
    LUNCH: 'lunch',
    TEA: 'tea',
    PERSONAL: 'personal',
    MEETING: 'meeting'
});



module.exports = {
    USER_ROLES,
    PERMISSIONS,
    ATTENDANCE_STATUS,
    WORK_LOCATION,
    ATTENDANCE_METHOD,
    ATTENDANCE_BREAK_TYPE
};