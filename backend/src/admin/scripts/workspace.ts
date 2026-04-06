export const ADMIN_WORKSPACE_SCRIPT = String.raw`
function loadWorkspaceProfiles(){}
function saveWorkspaceProfiles(){}
function getProfileById(){return null;}
function selectedProfile(){return null;}
function activeProfile(){return null;}
function currentScope(){return{seasonId:undefined};}
function activeScope(){return{seasonId:undefined};}
function hydrateWorkspaceUi(){}
async function createWorkspaceProfile(){toast('Workspace lists removed. Using single working list.');}
async function setActiveWorkspace(){toast('Workspace lists removed. Using single working list.');}
async function deleteWorkspaceProfile(){toast('Workspace lists removed. Using single working list.');}
`;
