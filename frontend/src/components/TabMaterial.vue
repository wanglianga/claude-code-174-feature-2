<template>
  <div>
    <el-alert
      title="施工材料抽查：施工队提交加固完成照片后，验收人员发现钢梁等关键材料规格与方案不一致时，平台要求施工队上传材料发票、进场照片和现场测量结果；判定偷换属实的，施工队进入限制接单名单、农户补助拨付暂停、整改任务退回返工，并重新安排验收节点与补助拨付计划。返工整改后须对照原方案逐项复验，不能只凭一张完工照片关闭任务。"
      type="error" :closable="false" show-icon style="margin-bottom:12px" />

    <el-card shadow="never">
      <template #header>
        材料抽查记录
        <el-button v-if="canJudge && canStartCheck" type="danger" plain size="small" style="float:right" @click="openCreate">
          发起材料抽查
        </el-button>
      </template>
      <el-timeline v-if="checks.length">
        <el-timeline-item v-for="c in checks" :key="c.id" :timestamp="fmtDate(c.raisedAt)" placement="top"
          :type="c.status==='CONFIRMED_SWAP' ? 'danger' : c.status==='EVIDENCE_OK' ? 'success' : 'warning'">
          <el-card shadow="hover" class="mc-card">
            <div class="mc-head">
              <el-tag :type="MATERIAL_CHECK_STATUS[c.status]?.type">{{ MATERIAL_CHECK_STATUS[c.status]?.label }}</el-tag>
              <b style="margin-left:8px">{{ c.materialName || '材料' }} 抽查</b>
              <span class="sub" style="margin-left:8px">方案要求：{{ c.expectedSpec || '—' }} ｜ 现场：{{ c.actualSpec || '—' }}</span>
              <span class="op">{{ c.raisedByName }}</span>
            </div>
            <div class="mc-body">{{ c.finding }}</div>

            <!-- 举证材料 -->
            <template v-if="c.invoiceFiles?.length || c.entryPhotos?.length || c.measureResults?.length">
              <el-divider style="margin:8px 0">施工队举证材料（{{ fmtDate(c.evidencedAt) }}）</el-divider>
              <el-descriptions :column="1" size="small" border>
                <el-descriptions-item label="材料发票">
                  <el-link v-for="(u,i) in c.invoiceFiles" :key="'iv'+i" :href="u" target="_blank" type="primary" style="margin-right:10px">发票{{ i+1 }}</el-link>
                </el-descriptions-item>
                <el-descriptions-item label="进场照片">
                  <el-link v-for="(u,i) in c.entryPhotos" :key="'en'+i" :href="u" target="_blank" type="primary" style="margin-right:10px">进场照片{{ i+1 }}</el-link>
                </el-descriptions-item>
              </el-descriptions>
              <el-table :data="c.measureResults" size="small" border style="margin-top:6px">
                <el-table-column prop="item" label="现场测量项" />
                <el-table-column prop="expected" label="方案要求" width="120" />
                <el-table-column prop="measured" label="实测值" width="120" />
                <el-table-column label="是否相符" width="100">
                  <template #default="{ row }">
                    <el-tag size="small" :type="row.conform ? 'success' : 'danger'">{{ row.conform ? '相符' : '不符' }}</el-tag>
                  </template>
                </el-table-column>
              </el-table>
              <div v-if="c.evidenceNote" class="sub" style="margin-top:4px">举证说明：{{ c.evidenceNote }}</div>
            </template>

            <!-- 判定结论 -->
            <template v-if="c.verdict">
              <el-divider style="margin:8px 0">验收判定</el-divider>
              <el-tag :type="c.verdict==='CONFIRMED' ? 'danger' : 'success'">
                {{ c.verdict==='CONFIRMED' ? '偷换材料属实' : '举证充分，不存在偷换' }}
              </el-tag>
              <span class="sub" style="margin-left:8px">{{ c.verdictNote }}</span>
            </template>

            <!-- 属实后的处置 -->
            <template v-if="c.status==='CONFIRMED_SWAP'">
              <el-alert type="error" :closable="false" show-icon style="margin:8px 0"
                title="已联动处置：① 施工队进入限制接单名单；② 农户补助拨付暂停；③ 整改任务退回返工状态，必改项全部退回待施工；④ 重新安排验收节点与补助拨付计划。" />
              <el-descriptions :column="1" size="small" border>
                <el-descriptions-item label="返工整改期限">{{ c.reworkDeadline }}</el-descriptions-item>
                <el-descriptions-item label="重新安排验收节点">{{ c.replannedAcceptanceDate }}（验收人员对照原方案逐项确认）</el-descriptions-item>
                <el-descriptions-item label="补助拨付计划">{{ c.replannedPaymentDate }}（返工复验合格、销号后按新计划拨付）</el-descriptions-item>
                <el-descriptions-item label="返工要求">{{ c.reworkRequirement }}</el-descriptions-item>
              </el-descriptions>
            </template>

            <!-- 施工队提交返工整改 -->
            <template v-if="c.status==='CONFIRMED_SWAP' && !c.reworkSubmittedAt && canEvidence">
              <el-button type="warning" size="small" style="margin-top:8px" @click="openRework(c)">提交返工整改结果</el-button>
            </template>
            <template v-if="c.reworkSubmittedAt">
              <el-divider style="margin:8px 0">返工整改（{{ fmtDate(c.reworkSubmittedAt) }}）</el-divider>
              <div class="sub">{{ c.reworkDescription }}</div>
              <div style="margin-top:4px">
                <el-link v-for="(u,i) in c.reworkPhotos" :key="'rw'+i" :href="u" target="_blank" type="primary" style="margin-right:10px">整改照片{{ i+1 }}</el-link>
              </div>
            </template>

            <!-- 复验 -->
            <template v-if="c.status==='CONFIRMED_SWAP' && c.reworkSubmittedAt && canJudge">
              <el-button type="primary" size="small" style="margin-top:8px" @click="openRequalify(c)">对照原方案逐项复验</el-button>
            </template>
            <template v-if="c.requalifyNote">
              <el-divider style="margin:8px 0">返工复验结论（{{ fmtDate(c.requalifiedAt) }}）</el-divider>
              <el-tag type="success">复验合格</el-tag>
              <span class="sub" style="margin-left:8px">{{ c.requalifyNote }}</span>
              <div class="sub" style="margin-top:4px">已解除施工队限制接单、恢复补助拨付计划（仍须销号后发放），房屋进入待逐项验收。</div>
            </template>

            <!-- 操作按钮 -->
            <div style="margin-top:8px">
              <el-button v-if="c.status==='PENDING_EVIDENCE' && canEvidence" type="primary" size="small" @click="openEvidence(c)">
                上传举证（发票/进场照片/测量结果）
              </el-button>
              <el-button v-if="c.status==='UNDER_REVIEW' && canJudge" type="danger" size="small" @click="openVerdict(c)">
                出具抽查判定
              </el-button>
            </div>
          </el-card>
        </el-timeline-item>
      </el-timeline>
      <el-empty v-else description="暂无材料抽查记录" :image-size="60" />
    </el-card>

    <!-- 发起抽查 -->
    <el-dialog v-model="showCreate" title="发起施工材料抽查" width="640px">
      <el-form :model="createForm" label-width="120px">
        <el-form-item label="抽查材料">
          <el-select v-model="createForm.materialName" filterable allow-create style="width:100%" placeholder="如：H型钢梁 / 钢筋 / 防水卷材">
            <el-option v-for="b in archive.constructionPlan?.budgetItems || []" :key="b.id"
              :value="b.name" :label="`${b.name}（方案规格：${b.spec || '—'}）`" />
          </el-select>
        </el-form-item>
        <el-form-item label="现场实际规格"><el-input v-model="createForm.actualSpec" placeholder="如：H350×175×7×11" /></el-form-item>
        <el-form-item label="发现情况">
          <el-input v-model="createForm.finding" type="textarea" :rows="4"
            placeholder="说明完工照片与现场抽查的差异，如钢梁截面高度/翼缘宽度实测小于方案要求" />
        </el-form-item>
        <el-form-item label="取证照片">
          <el-upload :action="uploadUrl" :headers="headers" :on-success="(r)=>createForm.findingPhotos.push(r.url)" :show-file-list="false">
            <el-button size="small">上传加固完成照片/现场取证</el-button>
          </el-upload>
          <el-tag v-for="(u,i) in createForm.findingPhotos" :key="i" closable size="small" style="margin:4px 4px 0" @close="createForm.findingPhotos.splice(i,1)">照片{{i+1}}</el-tag>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreate=false">取消</el-button>
        <el-button type="primary" @click="submitCreate">发起抽查并要求施工队举证</el-button>
      </template>
    </el-dialog>

    <!-- 施工队举证 -->
    <el-dialog v-model="showEvidence" title="施工队举证：材料发票 · 进场照片 · 现场测量" width="720px">
      <el-form label-width="110px">
        <el-alert type="warning" :closable="false" show-icon style="margin-bottom:10px"
          title="三类材料缺一不可：材料发票、材料进场照片、现场测量结果（逐项填写方案要求与实测值）。" />
        <el-form-item label="材料发票" required>
          <el-upload :action="uploadUrl" :headers="headers" :on-success="(r)=>evidenceForm.invoiceFiles.push(r.url)" :show-file-list="false">
            <el-button size="small">上传发票</el-button>
          </el-upload>
          <el-tag v-for="(u,i) in evidenceForm.invoiceFiles" :key="i" closable size="small" style="margin:4px 4px 0" @close="evidenceForm.invoiceFiles.splice(i,1)">发票{{i+1}}</el-tag>
        </el-form-item>
        <el-form-item label="进场照片" required>
          <el-upload :action="uploadUrl" :headers="headers" :on-success="(r)=>evidenceForm.entryPhotos.push(r.url)" :show-file-list="false">
            <el-button size="small">上传进场照片</el-button>
          </el-upload>
          <el-tag v-for="(u,i) in evidenceForm.entryPhotos" :key="i" closable size="small" style="margin:4px 4px 0" @close="evidenceForm.entryPhotos.splice(i,1)">照片{{i+1}}</el-tag>
        </el-form-item>
        <el-form-item label="现场测量结果" required>
          <el-table :data="evidenceForm.measureResults" size="small" border>
            <el-table-column label="测量项"><template #default="{row}"><el-input v-model="row.item" size="small" placeholder="如：钢梁截面高度" /></template></el-table-column>
            <el-table-column label="方案要求" width="130"><template #default="{row}"><el-input v-model="row.expected" size="small" /></template></el-table-column>
            <el-table-column label="实测值" width="130"><template #default="{row}"><el-input v-model="row.measured" size="small" /></template></el-table-column>
            <el-table-column label="是否相符" width="100">
              <template #default="{row}"><el-switch v-model="row.conform" active-text="相符" inactive-text="不符" /></template>
            </el-table-column>
            <el-table-column label="操作" width="60"><template #default="{$index}"><el-button link type="danger" @click="evidenceForm.measureResults.splice($index,1)">删</el-button></template></el-table-column>
          </el-table>
          <el-button size="small" style="margin-top:6px" @click="evidenceForm.measureResults.push({item:'',expected:'',measured:'',conform:false})">+ 增加测量项</el-button>
        </el-form-item>
        <el-form-item label="举证说明"><el-input v-model="evidenceForm.evidenceNote" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEvidence=false">取消</el-button>
        <el-button type="primary" @click="submitEvidence">提交举证</el-button>
      </template>
    </el-dialog>

    <!-- 判定 -->
    <el-dialog v-model="showVerdict" title="抽查判定" width="680px">
      <el-form label-width="150px">
        <el-form-item label="判定结论">
          <el-radio-group v-model="verdictForm.verdict">
            <el-radio-button value="CONFIRMED">偷换材料属实</el-radio-button>
            <el-radio-button value="NOT_SWAP">举证充分，不存在偷换</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="判定依据" required><el-input v-model="verdictForm.verdictNote" type="textarea" :rows="3" /></el-form-item>
        <template v-if="verdictForm.verdict==='CONFIRMED'">
          <el-alert type="error" :closable="false" show-icon style="margin-bottom:10px"
            title="属实后系统将自动：施工队列入限制接单名单、暂停该户补助拨付、整改退回返工状态；请重新安排验收节点与补助拨付计划。" />
          <el-form-item label="返工整改期限" required><el-date-picker v-model="verdictForm.reworkDeadline" type="date" value-format="YYYY-MM-DD" /></el-form-item>
          <el-form-item label="重新验收节点" required><el-date-picker v-model="verdictForm.replannedAcceptanceDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
          <el-form-item label="补助拨付计划" required><el-date-picker v-model="verdictForm.replannedPaymentDate" type="date" value-format="YYYY-MM-DD" /></el-form-item>
          <el-form-item label="返工整改要求"><el-input v-model="verdictForm.reworkRequirement" type="textarea" :rows="2" placeholder="拆除偷换材料、按原方案规格重新采购施工的具体要求" /></el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="showVerdict=false">取消</el-button>
        <el-button :type="verdictForm.verdict==='CONFIRMED' ? 'danger' : 'primary'" @click="submitVerdict">提交判定</el-button>
      </template>
    </el-dialog>

    <!-- 返工整改 -->
    <el-dialog v-model="showRework" title="提交返工整改结果" width="620px">
      <el-form label-width="110px">
        <el-form-item label="整改说明" required>
          <el-input v-model="reworkForm.reworkDescription" type="textarea" :rows="4"
            placeholder="说明如何拆除偷换材料、按原方案规格重新采购与施工（钢梁规格、数量、焊接/托换情况）" />
        </el-form-item>
        <el-form-item label="整改完成照片" required>
          <el-upload :action="uploadUrl" :headers="headers" :on-success="(r)=>reworkForm.reworkPhotos.push(r.url)" :show-file-list="false">
            <el-button size="small">上传整改后照片</el-button>
          </el-upload>
          <el-tag v-for="(u,i) in reworkForm.reworkPhotos" :key="i" closable size="small" style="margin:4px 4px 0" @close="reworkForm.reworkPhotos.splice(i,1)">照片{{i+1}}</el-tag>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showRework=false">取消</el-button>
        <el-button type="warning" @click="submitRework">提交整改，申请复验</el-button>
      </template>
    </el-dialog>

    <!-- 复验 -->
    <el-dialog v-model="showRequalify" title="返工复验（对照原方案逐项确认）" width="620px">
      <el-alert type="info" :closable="false" show-icon style="margin-bottom:10px"
        title="复验须对照原方案逐项核验材料规格与施工质量，合格后解除施工队限制、恢复补助拨付计划，并重新组织逐项验收。" />
      <el-input v-model="requalifyNote" type="textarea" :rows="5" placeholder="逐项说明：钢梁规格实测是否已符合 H400×200、托换焊接质量、警示措施等" />
      <template #footer>
        <el-button @click="showRequalify=false">取消</el-button>
        <el-button type="primary" @click="submitRequalify">复验合格，恢复流程</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../api';
import { MATERIAL_CHECK_STATUS, fmtDate } from '../labels';
import { useAuthStore } from '../store';

const props = defineProps(['archive']);
const emit = defineEmits(['reload']);
const auth = useAuthStore();
const uploadUrl = '/api/upload';
const headers = computed(() => ({ Authorization: `Bearer ${localStorage.getItem('rhs_token')}` }));
const canJudge = ['ACCEPTOR', 'TOWNSHIP_REVIEWER', 'COUNTY_ADMIN'].includes(auth.role);
const canEvidence = ['TEAM', 'TOWNSHIP_REVIEWER', 'GRID_WORKER', 'COUNTY_ADMIN'].includes(auth.role);
const canStartCheck = computed(() => ['ACCEPTOR', 'TOWNSHIP_REVIEWER', 'COUNTY_ADMIN'].includes(auth.role));
const checks = computed(() => props.archive.materialChecks || []);

const showCreate = ref(false);
const showEvidence = ref(false);
const showVerdict = ref(false);
const showRework = ref(false);
const showRequalify = ref(false);
const activeId = ref('');
const requalifyNote = ref('');
const createForm = reactive({ materialName: '', actualSpec: '', finding: '', findingPhotos: [] });
const evidenceForm = reactive({ invoiceFiles: [], entryPhotos: [], measureResults: [], evidenceNote: '' });
const verdictForm = reactive({ verdict: 'CONFIRMED', verdictNote: '', reworkDeadline: '', replannedAcceptanceDate: '', replannedPaymentDate: '', reworkRequirement: '' });
const reworkForm = reactive({ reworkDescription: '', reworkPhotos: [] });

function openCreate() {
  Object.assign(createForm, { materialName: '', actualSpec: '', finding: '', findingPhotos: [] });
  showCreate.value = true;
}
async function submitCreate() {
  if (!createForm.finding) return ElMessage.warning('请填写抽查发现情况');
  await http.post('/api/material-checks', { houseId: props.archive.house.id, ...createForm });
  ElMessage.success('已发起抽查，平台要求施工队上传发票、进场照片和现场测量结果');
  showCreate.value = false;
  emit('reload');
}
function openEvidence(c) {
  activeId.value = c.id;
  Object.assign(evidenceForm, { invoiceFiles: [], entryPhotos: [], measureResults: [], evidenceNote: '' });
  showEvidence.value = true;
}
async function submitEvidence() {
  await http.post(`/api/material-checks/${activeId.value}/evidence`, evidenceForm);
  ElMessage.success('举证材料已提交，待验收人员判定');
  showEvidence.value = false;
  emit('reload');
}
function openVerdict(c) {
  activeId.value = c.id;
  Object.assign(verdictForm, {
    verdict: 'CONFIRMED', verdictNote: '',
    reworkDeadline: c.reworkDeadline || '', replannedAcceptanceDate: c.replannedAcceptanceDate || '',
    replannedPaymentDate: c.replannedPaymentDate || '', reworkRequirement: '',
  });
  showVerdict.value = true;
}
async function submitVerdict() {
  const payload = { ...verdictForm };
  await http.post(`/api/material-checks/${activeId.value}/verdict`, payload);
  ElMessage.success(verdictForm.verdict === 'CONFIRMED' ? '已判定偷换属实，联动限制接单/补助暂停/返工重排' : '已判定不存在偷换');
  showVerdict.value = false;
  emit('reload');
}
function openRework(c) {
  activeId.value = c.id;
  Object.assign(reworkForm, { reworkDescription: '', reworkPhotos: [] });
  showRework.value = true;
}
async function submitRework() {
  await http.post(`/api/material-checks/${activeId.value}/rework`, reworkForm);
  ElMessage.success('返工整改结果已提交，待验收人员对照原方案逐项复验');
  showRework.value = false;
  emit('reload');
}
function openRequalify(c) {
  activeId.value = c.id;
  requalifyNote.value = '';
  showRequalify.value = true;
}
async function submitRequalify() {
  if (!requalifyNote.value) return ElMessage.warning('请填写逐项复验结论');
  await http.post(`/api/material-checks/${activeId.value}/requalify`, { requalifyNote: requalifyNote.value });
  ElMessage.success('复验合格，已解除限制、恢复补助拨付计划');
  showRequalify.value = false;
  emit('reload');
}
</script>
<style scoped>
.mc-card { padding:6px 12px; }
.mc-head { display:flex; align-items:center; flex-wrap:wrap; }
.mc-body { color:#445; font-size:13px; margin-top:6px; }
.op { color:#9aa7b5; font-size:12px; margin-left:auto; }
.sub { color:#6b7888; font-size:12.5px; }
</style>
