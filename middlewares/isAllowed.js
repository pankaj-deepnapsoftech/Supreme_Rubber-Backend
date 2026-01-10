const { TryCatch, ErrorHandler } = require('../utils/error');

exports.isAllowed = TryCatch(async (req, res, next) => {
    const route = req.originalUrl.split('/')[2];  // Get the route name from URL

    const user = req.user;
    if (!user) {
        throw new ErrorHandler('User not found', 401);
    }

    // If the user is a superuser, allow access
    if (user.isSuper) {
        return next(); // Allow to proceed to next middleware/route handler
    }

    // Map route names to permission names
    const routeToPermissionMap = {
        'product': ['raw material', 'part name', 'compound name', 'inventory'], // Product route covers all inventory modules
        'supplier': 'supplier',
        'employee': 'employee',
        'user-role': 'user role',
        'gateman': 'gateman',
        'bom': 'bom',
        'production': 'production',
        'production-start': 'production start',
        'quality-check': 'quality check',
        'qc-history': 'qc history',
        'purchase-order': 'purchase order',
        'purchaseorder': 'purchase order',
    };

    // Get required permission(s) for this route
    const requiredPermissions = routeToPermissionMap[route];
    const permissionArray = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];

    // If the user is not a superuser, check permissions
    const permissions = user.role?.permissions || [];
    const lowerPermissions = permissions.map(p => p.toLowerCase());

    // Check if user has any of the required permissions
    const hasPermission = permissionArray.some(perm => 
        lowerPermissions.includes(perm.toLowerCase())
    );

    if (!hasPermission) {
        throw new ErrorHandler('You are not allowed to access this route', 403);  // Block if no permission
    }

    // If everything is okay, proceed to next middleware or route handler
    next();
});
