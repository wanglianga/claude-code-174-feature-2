<template>
  <div>
    <el-alert
      title="施工材料抽查：施工队提交加固完成照片后，验收人员可对照方案发起抽查（如钢梁规格不符）；平台要求施工队上传材料发票、进场照片和现场测量结果。判定偷换属实后：施工队进入限制接单名单、农户补助拨付暂停、整改任务退回返工；平台重新安排验收节点与补助拨付计划；返工后必须对照原方案逐项确认，不能只凭一张完工照片关闭任务。"
      type="warning" :closable="false" show-icon style="margin-bottom:12px" />

    <!-- 抽查记录 -->
    <el-card v-for="c in (archive.materialChecks||[])" :key="c.id" shadow="never" style="margin-bottom:12px">
      <template #header>
        <el-tag :type="MATERIAL_CHECK_STATUS[c.status].type">{{ MATERIAL_CHECK_STATUS[c.status].label }}</el-tag>
        <span style="margin-left:8px;font-weight:600">材料抽查 · {{ c.suspectItem }}</span>
        <span style="margin-left:8px;color:#909caa;font-size:12px">{{ c.teamName }} · {{ fmtDate(c.raisedAt) }} · {{ c.raisedByName }}</span>
      </template>

      <el-descriptions :column="2" size="small" border>
        <el-descriptions-item label="方案要求规格">{{ c.planSpec || '—' }}</el-descriptions-item>
        <el-descriptions-item label="现场发现规格">{{ c.foundSpec || '—' }}</el-descriptions-item>
        <el-descriptions-item label="抽查说明" :span="2">{{ c.suspectNote || '—' }}</el-descriptions-item>
        <el-descriptions-item label="加固完成照片" :span="2">
          <el-image v-for="(u,i) in (c.completionPhotos||[])" :key="i" :src="u" :preview-src-list="c.completionPhotos"
            style="width:64px;height:64px;margin-right:6px;object-fit:cover;border-radius:4px" fit="cover" />
          <span v-if="!(c.completionPhotos||[]).length">—</span>
        </el-descriptions-item>
      </el-descriptions>

      <!-- 举证三要素 -->
      <template v-if="c.evidenceAt">
        <el-divider content-position="left">施工队举证（三要素缺一不可）</el-divider>
        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item label="材料发票">
            <el-link v-for="(u,i) in (c.invoiceDocs||[])" :key="i" :href="u" target="_blank" style="margin-right:12px">发票{{ i+1 }}</el-link>
          </el-descriptions-item>
          <el-descriptions-item label="进场照片">
            <el-image v-for="(u,i) in (c.siteEntryPhotos||[])" :key="i" :src="u" :preview-src-list="c.siteEntryPhotos"
              style="width:64px;height:64px;margin-right:6px;object-fit:cover;border-radius:4px" fit="cover" />
          </el-descriptions-item>
          <el-descriptions-item label="现场测量结果">{{ c.measurementResult }}</el-descriptions-item>
          <el-descriptions-item v-if="(c.measurementPhotos||[]).length" label="测量佐证照片">
            <el-image v-for="(u,i) in c.measurementPhotos" :key="i" :src="u" :preview-src-list="c.measurementPhotos"
              style="width:64px;height:64px;margin-right:6px;object-fit:cover;border-radius:4px" fit="cover" />
          </el-descriptions-item>
        </el-descriptions>
      </template>

      <!-- 判定结果 -->
      <template v-if="c.verdict">
        <el-divider content-position="left">验收人员判定</el-divider>
        <el-tag :type="c.verdict==='SWAP'?'danger':'success'">{{ MATERIAL_CHECK_VERDICT[c.verdict] }}</el-tag>
        <span style="margin-left:8px">{{ c.verdictNote }}</span>
      </template>

      <!-- 偷换属实后的处置联动 -->
      <template v-if="c.status==='CONFIRMED_SWAP' || c.status==='REWORKED'">
        <el-divider content-position="left">处置联动与返工重排</el-divider>
        <el-alert type="error" :closable="false" show-icon style="margin-bottom:8px"
          title="偷换属实：施工队已进入限制接单名单（解除前不能承接新工程）；农户补助拨付暂停；整改任务退回返工。" />
        <el-descriptions :column="3" size="small" border>
          <el-descriptions-item label="返工期限">{{ c.reworkDeadline || '待安排' }}</el-descriptions-item>
          <el-descriptions-item label="重新验收节点">{{ c.newAcceptanceDate || '待安排' }}</el-descriptions-item>
          <el-descriptions-item label="补助拨付计划">{{ c.newPayPlanDate || '复验销号后安排' }}</el-descriptions-item>
        </el-descriptions>

        <!-- 返工提交内容 -->
        <template v-if="c.reworkSubmittedAt">
          <el-divider content-position="left">施工队返工整改（{{ fmtDate(c.reworkSubmittedAt) }}）</el-divider>
          <div class="sub" style="margin-bottom:6px">{{ c.reworkSummary }}</div>
          <el-image v-for="(u,i) in (c.reworkPhotos||[])" :key="i" :src="u" :preview-src-list="c.reworkPhotos"
            style="width:64px;height:64px;margin-right:6px;object-fit:cover;border-radius:4px" fit="cover" />
          <div class="sub" style="margin-top:6px">返工实测/合格证明：{{ (c.reworkMeasurement||[]).join('；') }}</div>
        </template>
      </template>

      <!-- 操作区 -->
      <div style="margin-top:10px">
        <!-- 待举证：施工队上传三要素 -->
        <el-button v-if="c.status==='OPEN' && canEvidence" type="primary" @click="openEvidence(c)">上传发票/进场照片/测量结果</el-button>
        <!-- 已举证待判定：验收人员判定 -->
        <el-button v-if="c.status==='EVIDENCE_SUBMITTED' && canVerdict" type="danger" @click="openVerdict(c,'SWAP')">判定偷换属实</el-button>
        <el-button v-if="c.status==='EVIDENCE_SUBMITTED' && canVerdict" type="success" @click="openVerdict(c,'MATCH')">比对一致·澄清</el-button>
        <!-- 偷换属实：平台重排节点 -->
        <el-button v-if="c.status==='CONFIRMED_SWAP' && !c.newAcceptanceDate && canSchedule" type="warning" @click="openSchedule(c)">重新安排验收/拨付节点</el-button>
        <el-button v-if="c.status==='CONFIRMED_SWAP' && c.newAcceptanceDate && !c.reworkSubmittedAt && canSchedule" plain size="small" @click="openSchedule(c)">调整节点安排</el-button>
        <!-- 施工队返工提交 -->
        <el-button v-if="c.status==='CONFIRMED_SWAP' && c.newAcceptanceDate && !c.reworkSubmittedAt && canEvidence" type="primary" @click="openRework(c)">返工完成·提交整改</el-button>
        <!-- 验收人员逐项复验 -->
        <el-button v-if="c.status==='CONFIRMED_SWAP' && c.reworkSubmittedAt && canVerdict" type="success" @click="openReview(c)">对照原方案逐项复验</el-button>
      </div>
    </el-card>

    <el-empty v-if="!(archive.materialChecks||[]).length" description="暂无材料抽查记录" :image-size="60" />

    <!-- 发起抽查 -->
    <el-button v-if="canVerdict && !(archive.materialChecks||[]).some(isOpen)" type="danger" plain style="margin-top:4px" @click="openCreate">
      发起施工材料抽查
    </el-button>

    <!-- 发起抽查弹窗 -->
    <el-dialog v-model="createShow" title="发起施工材料抽查" width="560px">
      <el-form :model="createForm" label-width="120px">
        <el-form-item label="抽查材料/部位" required><el-input v-model="createForm.suspectItem" placeholder="如：钢梁" /></el-form-item>
        <el-form-item label="方案要求规格"><el-input v-model="createForm.planSpec" placeholder="如：Q355B HN200×100（腹板≥5.5mm）" /></el-form-item>
        <el-form-item label="现场发现规格"><el-input v-model="createForm.foundSpec" placeholder="如：钢印Q235，实测腹板4.5mm" /></el-form-item>
        <el-form-item label="抽查说明"><el-input v-model="createForm.suspectNote" type="textarea" :rows="3" placeholder="完工照片与现场实物不符的具体情况" /></el-form-item>
        <el-form-item label="完工照片">
          <el-upload :action="uploadUrl" :headers="headers" :on-success="(r)=>createForm.completionPhotos.push(r.url)" :show-file-list="false">
            <el-button size="small">上传完工照片</el-button>
          </el-upload>
          <el-tag v-for="(u,i) in createForm.completionPhotos" :key="i" closable size="small" style="margin:4px 4px 0" @close="createForm.completionPhotos.splice(i,1)">照片{{i+1}}</el-tag>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createShow=false">取消</el-button>
        <el-button type="danger" @click="submitCreate">发起抽查（通知施工队举证）</el-button>
      </template>
    </el-dialog>

    <!-- 举证弹窗 -->
    <el-dialog v-model="evidenceShow" title="施工队举证：材料发票 / 进场照片 / 现场测量结果" width="560px">
      <el-form :model="evidenceForm" label-width="120px">
        <el-form-item label="材料发票" required>
          <el-upload :action="uploadUrl" :headers="headers" :on-success="(r)=>evidenceForm.invoiceDocs.push(r.url)" :show-file-list="false">
            <el-button size="small">上传发票</el-button>
          </el-upload>
          <el-tag v-for="(u,i) in evidenceForm.invoiceDocs" :key="i" closable size="small" style="margin:4px 4px 0" @close="evidenceForm.invoiceDocs.splice(i,1)">发票{{i+1}}</el-tag>
        </el-form-item>
        <el-form-item label="进场照片" required>
          <el-upload :action="uploadUrl" :headers="headers" :on-success="(r)=>evidenceForm.siteEntryPhotos.push(r.url)" :show-file-list="false">
            <el-button size="small">上传进场照片</el-button>
          </el-upload>
          <el-tag v-for="(u,i) in evidenceForm.siteEntryPhotos" :key="i" closable size="small" style="margin:4px 4px 0" @close="evidenceForm.siteEntryPhotos.splice(i,1)">照片{{i+1}}</el-tag>
        </el-form-item>
        <el-form-item label="现场测量结果" required>
          <el-input v-model="evidenceForm.measurementResult" type="textarea" :rows="3" placeholder="实测规格/尺寸数据，如：腹板卡尺实测4.5mm、梁高198mm、钢印Q235" />
        </el-form-item>
        <el-form-item label="测量佐证照片">
          <el-upload :action="uploadUrl" :headers="headers" :on-success="(r)=>evidenceForm.measurementPhotos.push(r.url)" :show-file-list="false">
            <el-button size="small">上传测量照片</el-button>
          </el-upload>
          <el-tag v-for="(u,i) in evidenceForm.measurementPhotos" :key="i" closable size="small" style="margin:4px 4px 0" @close="evidenceForm.measurementPhotos.splice(i,1)">照片{{i+1}}</el-tag>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="evidenceShow=false">取消</el-button>
        <el-button type="primary" @click="submitEvidence">提交举证</el-button>
      </template>
    </el-dialog>

    <!-- 判定弹窗 -->
    <el-dialog v-model="verdictShow" :title="`判定：${MATERIAL_CHECK_VERDICT[verdictForm.verdict]||''}`" width="520px">
      <el-alert v-if="verdictForm.verdict==='SWAP'" type="error" :closable="false" show-icon style="margin-bottom:10px"
        title="确认偷换属实后系统将：①施工队列入限制接单名单 ②农户补助拨付暂停 ③整改任务退回返工 ④生成阻断性异常，须重排验收/拨付节点并逐项复验" />
      <el-form label-width="100px">
        <el-form-item label="判定意见"><el-input v-model="verdictForm.note" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="verdictShow=false">取消</el-button>
        <el-button :type="verdictForm.verdict==='SWAP'?'danger':'success'" @click="submitVerdict">确认判定</el-button>
      </template>
    </el-dialog>

    <!-- 重排节点弹窗 -->
    <el-dialog v-model="scheduleShow" title="重新安排验收节点与补助拨付计划" width="520px">
      <el-form :model="scheduleForm" label-width="130px">
        <el-form-item label="返工期限" required>
          <el-date-picker v-model="scheduleForm.reworkDeadline" type="date" value-format="YYYY-MM-DD" placeholder="选择返工完成期限" />
        </el-form-item>
        <el-form-item label="重新验收节点" required>
          <el-date-picker v-model="scheduleForm.newAcceptanceDate" type="date" value-format="YYYY-MM-DD" placeholder="返工后重新验收日期" />
        </el-form-item>
        <el-form-item label="补助拨付计划">
          <el-date-picker v-model="scheduleForm.newPayPlanDate" type="date" value-format="YYYY-MM-DD" placeholder="复验销号后的计划拨付日期" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="scheduleShow=false">取消</el-button>
        <el-button type="warning" @click="submitSchedule">保存节点安排</el-button>
      </template>
    </el-dialog>

    <!-- 返工提交弹窗 -->
    <el-dialog v-model="reworkShow" title="返工完成·重新提交整改" width="560px">
      <el-alert type="warning" :closable="false" show-icon style="margin-bottom:10px"
        title="返工整改不能只传一张完工照片：须说明如何更换为方案要求材料，并提供返工后照片与实测/合格证明；验收人员将对照原方案逐项确认。" />
      <el-form :model="reworkForm" label-width="130px">
        <el-form-item label="返工情况说明" required>
          <el-input v-model="reworkForm.reworkSummary" type="textarea" :rows="3" placeholder="如：拆除6根Q235钢梁，全部更换为Q355B HN200×100，腹板≥5.5mm" />
        </el-form-item>
        <el-form-item label="返工后照片" required>
          <el-upload :action="uploadUrl" :headers="headers" :on-success="(r)=>reworkForm.reworkPhotos.push(r.url)" :show-file-list="false">
            <el-button size="small">上传返工照片</el-button>
          </el-upload>
          <el-tag v-for="(u,i) in reworkForm.reworkPhotos" :key="i" closable size="small" style="margin:4px 4px 0" @close="reworkForm.reworkPhotos.splice(i,1)">照片{{i+1}}</el-tag>
        </el-form-item>
        <el-form-item label="返工实测/合格证" required>
          <div v-for="(v,i) in reworkForm.reworkMeasurement" :key="i" style="margin-bottom:4px">
            <el-input v-model="reworkForm.reworkMeasurement[i]" size="small" style="width:300px" placeholder="如：钢梁复验 Q355B 腹板5.6mm / 材质单编号" />
            <el-button link type="danger" size="small" @click="reworkForm.reworkMeasurement.splice(i,1)">删</el-button>
          </div>
          <el-button size="small" @click="reworkForm.reworkMeasurement.push('')">+ 添加实测/合格证明</el-button>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reworkShow=false">取消</el-button>
        <el-button type="primary" @click="submitRework">提交返工整改</el-button>
      </template>
    </el-dialog>

    <!-- 逐项复验弹窗 -->
    <el-dialog v-model="reviewShow" title="对照原方案逐项复验（任一项不合格即不能结案）" width="720px">
      <el-table :data="reviewForm" size="small" border>
        <el-table-column label="原方案整改项" min-width="200">
          <template #default="{row}">{{ ITEM_TYPES[row.itemType] }}<div class="sub">{{ row.description }}</div></template>
        </el-table-column>
        <el-table-column label="复验结论" width="200">
          <template #default="{row}">
            <el-radio-group v-model="row.result" size="small">
              <el-radio-button value="PASS">合格</el-radio-button>
              <el-radio-button value="FAIL">不合格</el-radio-button>
            </el-radio-group>
          </template>
        </el-table-column>
        <el-table-column label="复验说明"><template #default="{row}"><el-input v-model="row.note" size="small" placeholder="对照方案实测情况" /></template></el-table-column>
      </el-table>
      <el-form label-width="90px" style="margin-top:10px">
        <el-form-item label="复验意见"><el-input v-model="reviewComment" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reviewShow=false">取消</el-button>
        <el-button type="success" @click="submitReview">逐项确认·结案</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../api';
import { ITEM_TYPES, MATERIAL_CHECK_STATUS, MATERIAL_CHECK_VERDICT, fmtDate } from '../labels';
import { useAuthStore } from '../store';

const props = defineProps(['archive']);
const emit = defineEmits(['reload']);
const auth = useAuthStore();
const uploadUrl = '/api/upload';
const headers = computed(() => ({ Authorization: `Bearer ${localStorage.getItem('rhs_token')}` }));
const canVerdict = ['ACCEPTOR', 'TOWNSHIP_REVIEWER', 'COUNTY_ADMIN'].includes(auth.role);
const canSchedule = ['TOWNSHIP_REVIEWER', 'COUNTY_ADMIN'].includes(auth.role);
const canEvidence = ['TEAM', 'TOWNSHIP_REVIEWER', 'GRID_WORKER', 'COUNTY_ADMIN'].includes(auth.role);

const isOpen = (c) => ['OPEN', 'EVIDENCE_SUBMITTED', 'CONFIRMED_SWAP'].includes(c.status);
const houseId = computed(() => props.archive.house?.id);

const createShow = ref(false);
const evidenceShow = ref(false);
const verdictShow = ref(false);
const scheduleShow = ref(false);
const reworkShow = ref(false);
const reviewShow = ref(false);
const activeId = ref('');
const reviewComment = ref('');

const emptyCreate = () => ({ suspectItem: '', planSpec: '', foundSpec: '', suspectNote: '', completionPhotos: [] });
const createForm = reactive(emptyCreate());
const evidenceForm = reactive({ invoiceDocs: [], siteEntryPhotos: [], measurementResult: '', measurementPhotos: [] });
const verdictForm = reactive({ verdict: 'SWAP', note: '' });
const emptySchedule = () => ({ reworkDeadline: '', newAcceptanceDate: '', newPayPlanDate: '' });
const scheduleForm = reactive(emptySchedule());
const reworkForm = reactive({ reworkSummary: '', reworkPhotos: [], reworkMeasurement: [''] });
const reviewForm = ref([]);

async function post(path, payload) {
  await http.post(path, payload);
  emit('reload');
}

function openCreate() {
  Object.assign(createForm, emptyCreate());
  createShow.value = true;
}
async function submitCreate() {
  if (!createForm.suspectItem) return ElMessage.warning('请填写抽查材料/部位');
  await post('/api/material-checks', { houseId: houseId.value, ...createForm });
  ElMessage.success('抽查已发起，已通知施工队举证');
  createShow.value = false;
}

function openEvidence(c) {
  activeId.value = c.id;
  Object.assign(evidenceForm, { invoiceDocs: [], siteEntryPhotos: [], measurementResult: '', measurementPhotos: [] });
  evidenceShow.value = true;
}
async function submitEvidence() {
  if (!evidenceForm.invoiceDocs.length) return ElMessage.warning('必须上传材料发票');
  if (!evidenceForm.siteEntryPhotos.length) return ElMessage.warning('必须上传进场照片');
  if (!evidenceForm.measurementResult) return ElMessage.warning('必须填写现场测量结果');
  await post(`/api/material-checks/${activeId.value}/evidence`, { ...evidenceForm });
  ElMessage.success('举证已提交，等待验收人员判定');
  evidenceShow.value = false;
}

function openVerdict(c, verdict) {
  activeId.value = c.id;
  Object.assign(verdictForm, { verdict, note: '' });
  verdictShow.value = true;
}
async function submitVerdict() {
  await post(`/api/material-checks/${activeId.value}/verdict`, { ...verdictForm });
  ElMessage.success(verdictForm.verdict === 'SWAP' ? '已判定偷换属实，联动处置已触发' : '比对一致，抽查澄清结案');
  verdictShow.value = false;
}

function openSchedule(c) {
  activeId.value = c.id;
  Object.assign(scheduleForm, {
    reworkDeadline: c.reworkDeadline || '', newAcceptanceDate: c.newAcceptanceDate || '', newPayPlanDate: c.newPayPlanDate || '',
  });
  scheduleShow.value = true;
}
async function submitSchedule() {
  if (!scheduleForm.reworkDeadline || !scheduleForm.newAcceptanceDate) return ElMessage.warning('请填写返工期限和重新验收节点');
  await post(`/api/material-checks/${activeId.value}/schedule`, { ...scheduleForm });
  ElMessage.success('验收节点与补助拨付计划已重新安排');
  scheduleShow.value = false;
}

function openRework(c) {
  activeId.value = c.id;
  Object.assign(reworkForm, { reworkSummary: '', reworkPhotos: [], reworkMeasurement: [''] });
  reworkShow.value = true;
}
async function submitRework() {
  const meas = reworkForm.reworkMeasurement.filter(Boolean);
  if (!reworkForm.reworkSummary) return ElMessage.warning('请填写返工情况说明');
  if (!reworkForm.reworkPhotos.length) return ElMessage.warning('必须上传返工后照片');
  if (!meas.length) return ElMessage.warning('必须提供返工后实测/合格证明');
  await post(`/api/material-checks/${activeId.value}/rework`, {
    reworkSummary: reworkForm.reworkSummary, reworkPhotos: reworkForm.reworkPhotos, reworkMeasurement: meas,
  });
  ElMessage.success('返工整改已提交，等待逐项复验');
  reworkShow.value = false;
}

function openReview(c) {
  activeId.value = c.id;
  reviewComment.value = '';
  reviewForm.value = (props.archive.plans?.[0]?.items || [])
    .filter((i) => i.required)
    .map((i) => ({ itemId: i.id, itemType: i.type, description: i.description, result: 'PASS', note: '' }));
  reviewShow.value = true;
}
async function submitReview() {
  if (reviewForm.value.some((r) => !r.result)) return ElMessage.warning('每个整改项都要给出复验结论');
  const { data } = await http.post(`/api/material-checks/${activeId.value}/review`, {
    itemResults: reviewForm.value, comment: reviewComment.value,
  });
  ElMessage.success(`逐项复验通过，已生成重新验收记录${data?.id ? '' : ''}`);
  reviewShow.value = false;
  emit('reload');
}
</script>
<style scoped>.sub { color:#8a97a6; font-size:12px; margin-top:2px; }</style>
