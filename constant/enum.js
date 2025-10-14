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


module.exports = {
    USER_ROLES,
    PERMISSIONS
};