'use server'

// Legacy alias module — all behavior delegates to oikos.action.ts.
// "Circle" is reserved for discipleship groups; oikos is the personal network.
export {
  getOikosContacts as getCircles,
  addOikosPerson as addCirclePerson,
  updateOikosPerson as updateCirclePerson,
  deleteOikosPerson as deleteCirclePerson,
  togglePlannedConversation,
} from './oikos.action'
