// Resolve the same mode for native execution and the model's instructions.
export function effectivePermission(requested,settings={}){
  for(const value of [requested,settings.approval]){
    if(['confirm','auto','full'].includes(value))return value;
  }
  return settings.fullAccess===true?'full':'auto';
}
