// TODO: write a middleware to check if the user has the required permissions to access the resource
// GRAPHQL => if error => throw error
// Step 1: get user from req.session.user.rolesIds => get all roles
// Step 2: get roles-permissions => permissions target
// Step 3: check api the user call (req) and compare with permissions
