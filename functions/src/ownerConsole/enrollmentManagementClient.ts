type EnrollmentIdentity = Readonly<{ userId: string; courseId: string }>;
type EnrollmentSelectionToken = Readonly<{
  generation: number;
  identity: string;
}>;

const enrollmentInspectionGuardSource = Function.prototype.toString
  .call(createEnrollmentInspectionGuard)
  .replaceAll("\n", " ");
Object.defineProperty(createEnrollmentInspectionGuard, "toString", {
  value: () => enrollmentInspectionGuardSource,
});

export function createEnrollmentInspectionGuard() {
  let generation = 0;
  let selectedIdentity: string | null = null;
  let actionableIdentity: string | null = null;
  let reviewed: EnrollmentSelectionToken | null = null;

  function identity(value: EnrollmentIdentity) {
    return `${value.userId}\u0000${value.courseId}`;
  }

  function isCurrent(token: EnrollmentSelectionToken) {
    return (
      token.generation === generation && token.identity === selectedIdentity
    );
  }

  return {
    beginInspection(value: EnrollmentIdentity) {
      generation += 1;
      selectedIdentity = identity(value);
      actionableIdentity = null;
      reviewed = null;
      return { generation, identity: selectedIdentity };
    },
    isCurrentInspection(token: EnrollmentSelectionToken) {
      return isCurrent(token);
    },
    acceptInspection(
      token: EnrollmentSelectionToken,
      value: EnrollmentIdentity,
    ) {
      if (!isCurrent(token) || identity(value) !== token.identity) return false;
      actionableIdentity = token.identity;
      return true;
    },
    rejectInspection(token: EnrollmentSelectionToken) {
      if (!isCurrent(token)) return false;
      actionableIdentity = null;
      reviewed = null;
      return true;
    },
    beginReview(value: EnrollmentIdentity) {
      const currentIdentity = identity(value);
      reviewed = null;
      if (
        currentIdentity !== selectedIdentity ||
        currentIdentity !== actionableIdentity
      ) {
        return null;
      }
      return { generation, identity: currentIdentity };
    },
    isCurrentReview(token: EnrollmentSelectionToken) {
      return (
        isCurrent(token) &&
        token.identity === actionableIdentity &&
        reviewed === null
      );
    },
    acceptReview(token: EnrollmentSelectionToken, value: EnrollmentIdentity) {
      if (
        !isCurrent(token) ||
        token.identity !== actionableIdentity ||
        identity(value) !== token.identity
      ) {
        return false;
      }
      reviewed = token;
      return true;
    },
    canApply() {
      return (
        reviewed !== null &&
        isCurrent(reviewed) &&
        reviewed.identity === actionableIdentity
      );
    },
    matchesReviewed(value: EnrollmentIdentity) {
      return reviewed !== null && identity(value) === reviewed.identity;
    },
    invalidate() {
      generation += 1;
      selectedIdentity = null;
      actionableIdentity = null;
      reviewed = null;
    },
    snapshot() {
      return { generation, selectedIdentity, actionableIdentity, reviewed };
    },
  };
}

export const ENROLLMENT_MANAGEMENT_CLIENT_JS = `const createEnrollmentInspectionGuard=${createEnrollmentInspectionGuard.toString()};const enrollmentSelectionGuard=createEnrollmentInspectionGuard();const enrollmentSection=document.createElement('section');enrollmentSection.innerHTML='<h2>Enrollment Management</h2><div class="grid"><label>Search<input id="enrollmentSearch" autocomplete="off" placeholder="Student UID, Course ID or title"></label><label>Access state<select id="enrollmentState"><option value="">All</option><option value="active">Active</option><option value="expired">Expired</option><option value="revoked">Revoked</option></select></label><label>Course<select id="enrollmentCourse"><option value="">All Courses</option></select></label><button id="enrollmentRefresh" type="button">Refresh Enrollments</button></div><p id="enrollmentLimit" class="hint"></p><ul id="enrollmentList"></ul><div id="enrollmentInspection" hidden><h3>Selected Enrollment</h3><pre id="enrollmentDetails"></pre><button id="enrollmentRevoke" type="button" disabled>Review Revocation</button><button id="enrollmentReactivate" type="button" disabled>Review Reactivation</button><button id="enrollmentExtend" type="button" disabled>Review Extension</button></div>';document.querySelector('main').append(enrollmentSection);const enrollmentDialog=document.createElement('dialog');enrollmentDialog.innerHTML='<h2>Review Enrollment Change</h2><pre id="enrollmentReviewSummary"></pre><p id="enrollmentWarning"></p><label>Type the exact confirmation phrase<input id="enrollmentConfirmation" autocomplete="off"></label><button id="enrollmentApply" type="button">Apply</button><button id="enrollmentCancel" type="button">Cancel</button>';document.querySelector('main').append(enrollmentDialog);let enrollmentRows=[],selectedEnrollment=null,enrollmentReviewId=null,enrollmentConfirmationPhrase='';function enrollmentIdentity(x){return {userId:x.userId,courseId:x.courseId}}function enrollmentText(x){return [x.userId,x.courseId,x.courseTitle||''].join(' ').toLowerCase()}function clearEnrollmentActionableState(){selectedEnrollment=null;enrollmentReviewId=null;enrollmentConfirmationPhrase='';q('#enrollmentRevoke').disabled=true;q('#enrollmentReactivate').disabled=true;q('#enrollmentExtend').disabled=true;q('#enrollmentInspection').hidden=true;if(enrollmentDialog.open)enrollmentDialog.close()}function invalidateEnrollmentSelection(){enrollmentSelectionGuard.invalidate();clearEnrollmentActionableState()}function renderEnrollments(){const search=q('#enrollmentSearch').value.trim().toLowerCase(),state=q('#enrollmentState').value,courseFilter=q('#enrollmentCourse').value,list=q('#enrollmentList');list.innerHTML='';enrollmentRows.filter(x=>(!search||enrollmentText(x).includes(search))&&(!state||x.accessState===state)&&(!courseFilter||x.courseId===courseFilter)).forEach(x=>{const li=document.createElement('li'),button=document.createElement('button');button.type='button';button.textContent=x.userId+' - '+(x.courseTitle||x.courseId)+' - '+x.accessState;button.onclick=()=>inspectEnrollmentRow(x);li.append(button);list.append(li)});if(!list.children.length)list.innerHTML='<li>No matching Enrollments.</li>'}async function loadEnrollmentInventory(){invalidateEnrollmentSelection();const d=await api('/api/enrollments/inventory',{method:'POST',body:'{}'});enrollmentRows=d.enrollments;const courses=[...new Map(enrollmentRows.map(x=>[x.courseId,x.courseTitle||x.courseId])).entries()].sort((a,b)=>a[1].localeCompare(b[1],'en')),filter=q('#enrollmentCourse'),chosen=filter.value;filter.length=1;courses.forEach(([id,title])=>{const o=document.createElement('option');o.value=id;o.textContent=title+' ('+id+')';filter.append(o)});filter.value=chosen;q('#enrollmentLimit').textContent='Loaded '+enrollmentRows.length+' of a maximum '+d.limit+'.'+(d.limitReached?' The limit was reached.':'')+(d.malformedCount?' '+d.malformedCount+' malformed record(s) were excluded.':'');renderEnrollments()}async function inspectEnrollmentRow(x){const inspectionToken=enrollmentSelectionGuard.beginInspection(enrollmentIdentity(x));clearEnrollmentActionableState();q('#enrollmentDetails').textContent='Inspecting exact Enrollment…';q('#enrollmentInspection').hidden=false;try{const d=await api('/api/enrollments/inspect',{method:'POST',body:JSON.stringify(enrollmentIdentity(x))});if(!enrollmentSelectionGuard.acceptInspection(inspectionToken,enrollmentIdentity(d.enrollment)))return;selectedEnrollment=d.enrollment;q('#enrollmentDetails').textContent='Student UID: '+d.enrollment.userId+'\nCourse: '+(d.enrollment.courseTitle||d.enrollment.courseId)+' ('+d.enrollment.courseId+')\nStatus: '+d.enrollment.status+'\nAccess: '+d.enrollment.accessState+'\nGranted: '+d.enrollment.grantedAt+'\nExpires: '+(d.enrollment.expiresAt||'No expiration')+'\nSource: '+d.enrollment.source;q('#enrollmentRevoke').disabled=d.enrollment.status!=='active';q('#enrollmentReactivate').disabled=d.enrollment.status!=='revoked'||d.enrollment.accessState==='expired';q('#enrollmentExtend').disabled=d.enrollment.expiresAt===null;q('#enrollmentInspection').hidden=false}catch(e){if(!enrollmentSelectionGuard.isCurrentInspection(inspectionToken))return;enrollmentSelectionGuard.rejectInspection(inspectionToken);clearEnrollmentActionableState();showError(e)}}async function reviewEnrollmentChange(operation){if(!selectedEnrollment)return;const inspectedEnrollment=selectedEnrollment,reviewToken=enrollmentSelectionGuard.beginReview(enrollmentIdentity(inspectedEnrollment));if(!reviewToken){invalidateEnrollmentSelection();showError(new Error('Enrollment selection changed. Inspect it again.'));return}let body=enrollmentIdentity(inspectedEnrollment);if(operation==='extend'){const value=prompt('Enter the new expiration as a canonical ISO timestamp:');if(value===null)return;body={...body,expiresAt:value}}try{const d=await api('/api/enrollments/'+operation+'/review',{method:'POST',body:JSON.stringify(body)}),r=d.review;if(!enrollmentSelectionGuard.acceptReview(reviewToken,enrollmentIdentity(r)))return;enrollmentReviewId=d.reviewId;enrollmentConfirmationPhrase=operation==='revoke'?'REVOKE ENROLLMENT':operation==='reactivate'?'REACTIVATE ENROLLMENT':'EXTEND ENROLLMENT';q('#enrollmentReviewSummary').textContent='Student UID: '+r.userId+'\nCourse: '+r.courseId+'\nOperation: '+r.operation+'\nStatus: '+r.currentStatus+' -> '+r.proposedStatus+'\nExpiration: '+(r.currentExpiresAt||'No expiration')+' -> '+(r.proposedExpiresAt||'No expiration');q('#enrollmentWarning').textContent='Type exactly: '+enrollmentConfirmationPhrase;q('#enrollmentConfirmation').value='';enrollmentDialog.showModal()}catch(e){if(enrollmentSelectionGuard.isCurrentReview(reviewToken))showError(e)}}q('#enrollmentRevoke').onclick=()=>reviewEnrollmentChange('revoke');q('#enrollmentReactivate').onclick=()=>reviewEnrollmentChange('reactivate');q('#enrollmentExtend').onclick=()=>reviewEnrollmentChange('extend');q('#enrollmentCancel').onclick=()=>{enrollmentReviewId=null;enrollmentConfirmationPhrase='';enrollmentDialog.close()};q('#enrollmentApply').onclick=async e=>{e.target.disabled=true;try{if(!enrollmentSelectionGuard.canApply()||!selectedEnrollment||!enrollmentReviewId)throw new Error('Enrollment selection changed. Inspect it again.');const reviewedIdentity=enrollmentIdentity(selectedEnrollment),operation=selectedEnrollmentOperation(),reviewId=enrollmentReviewId,confirmation=q('#enrollmentConfirmation').value;const d=await api('/api/enrollments/'+operation+'/apply',{method:'POST',body:JSON.stringify({reviewId,confirmation})});if(!enrollmentSelectionGuard.matchesReviewed(enrollmentIdentity(d.result.enrollment)))throw new Error('Enrollment verification did not match the reviewed target.');enrollmentDialog.close();invalidateEnrollmentSelection();await loadEnrollmentInventory();const current=enrollmentRows.find(x=>x.userId===d.result.enrollment.userId&&x.courseId===d.result.enrollment.courseId);if(current)await inspectEnrollmentRow(current);if(!current||current.userId!==reviewedIdentity.userId||current.courseId!==reviewedIdentity.courseId)throw new Error('Enrollment verification did not match the reviewed target.');msg.textContent='Enrollment change succeeded and was verified.'}catch(x){invalidateEnrollmentSelection();showError(x)}finally{e.target.disabled=false}};function selectedEnrollmentOperation(){return enrollmentConfirmationPhrase==='REVOKE ENROLLMENT'?'revoke':enrollmentConfirmationPhrase==='REACTIVATE ENROLLMENT'?'reactivate':'extend'}q('#enrollmentRefresh').onclick=()=>loadEnrollmentInventory().catch(showError);q('#enrollmentSearch').oninput=renderEnrollments;q('#enrollmentState').onchange=renderEnrollments;q('#enrollmentCourse').onchange=renderEnrollments;function initializeEnrollmentInventory(){if(!csrf){setTimeout(initializeEnrollmentInventory,0);return}loadEnrollmentInventory().catch(showError)}initializeEnrollmentInventory();`;
