<template>
  <div>
    <!-- 家庭情况与权属 -->
    <el-card shadow="never">
      <template #header>家庭困难类型 · 房屋权属（补助资格前置材料）</template>
      <el-form :model="fam" label-width="130px" v-if="canEditFamily">
        <el-row :gutter="10">
          <el-col :span="10">
            <el-form-item label="家庭困难类型">
              <el-select v-model="fam.difficultyType" style="width:100%">
                <el-option v-for="(v,k) in DIFFICULTY" :key="k" :label="v" :value="k" />
              </el-select>
            </el-form-item>
            <el-form-item label="困难证明">
              <el-upload :action="uploadUrl" :headers="headers" :on-success="(r)=>fam.difficultyProof.push(r.url)" :show-file-list="false">
                <el-button size="small">上传证明材料</el-button>
              </el-upload>
              <el-tag v-for="(u,i) in fam.difficultyProof" :key="i" size="small" closable style="margin:4px 4px 0" @close="fam.difficultyProof.splice(i,1)">{{ u.split('/').pop() }}</el-tag>
            </el-form-item>
            <el-form-item label="权属类型">
              <el-select v-model="fam.ownershipType" style="width:100%">
                <el-option label="自有（宅基地）" value="自有（宅基地）" /><el-option label="继承" value="继承" /><el-option label="家庭共有" value="家庭共有" />
              </el-select>
            </el-form-item>
            <el-form-item label="权属证明">
              <el-upload :action="uploadUrl" :headers="headers" :on-success="(r)=>fam.ownershipProof.push(r.url)" :show-file-list="false">
                <el-button size="small">上传权属证明</el-button>
              </el-upload>
              <el-tag v-for="(u,i) in fam.ownershipProof" :key="i" size="small" closable style="margin:4px 4px 0" @close="fam.ownershipProof.splice(i,1)">{{ u.split('/').pop() }}</el-tag>
            </el-form-item>
          </el-col>
          <el-col :span="10">
            <el-form-item label="户主整改同意"><el-switch v-model="fam.ownerConsent" active-text="已签署同意书" /></el-form-item>
            <el-form-item label="家庭成员情况"><el-input v-model="fam.membersNote" type="textarea" :rows="5" placeholder="老人、病患、学生等需要安置照顾的情况" /></el-form-item>
          </el-col>
        </el-row>
        <el-button type="primary" @click="saveFamily">保存家庭与权属信息</el-button>
      </el-form>
      <el-descriptions v-else :column="2" size="small" border>
        <el-descriptions-item label="困难类型">{{ DIFFICULTY[archive.family?.difficultyType] || '未登记' }}</el-descriptions-item>
        <el-descriptions-item label="权属">{{ archive.family?.ownershipType || '未登记' }}</el-descriptions-item>
        <el-descriptions-item label="户主同意">{{ archive.family?.ownerConsent ? '已同意' : '未同意' }}</el-descriptions-item>
        <el-descriptions-item label="证明材料">{{ (archive.family?.difficultyProof?.length||0)+(archive.family?.ownershipProof?.length||0) }} 份</el-descriptions-item>
        <el-descriptions-item label="家庭情况" :span="2">{{ archive.family?.membersNote || '—' }}</el-descriptions-item>
      </el-descriptions>
    </el-card>

    <!-- 施工计划与预算 -->
    <el-card shadow="never" style="margin-top:12px">
      <template #header>施工计划 · 预算明细 · 施工队资质</template>
      <div v-if="archive.constructionPlan">
        <el-descriptions :column="3" size="small" border>
          <el-descriptions-item label="施工队">{{ archive.constructionPlan.teamName }}</el-descriptions-item>
          <el-descriptions-item label="工期">{{ archive.constructionPlan.startDate }} ~ {{ archive.constructionPlan.endDate }}</el-descriptions-item>
          <el-descriptions-item label="预算合计">¥{{ Number(archive.constructionPlan.budgetTotal).toLocaleString() }}</el-descriptions-item>
        </el-descriptions>
        <el-table :data="archive.constructionPlan.budgetItems" size="small" border style="margin-top:8px">
          <el-table-column prop="name" label="材料/项目" /><el-table-column prop="spec" label="规格（材料核验依据）" width="180" />
          <el-table-column prop="qty" label="数量" width="80" /><el-table-column prop="unit" label="单位" width="70" />
          <el-table-column label="单价" width="100"><template #default="{row}">¥{{row.unitPrice}}</template></el-table-column>
          <el-table-column label="金额" width="120"><template #default="{row}">¥{{row.amount}}</template></el-table-column>
        </el-table>
      </div>
      <el-empty v-else description="尚未提交施工计划（须先告知、停用/转移、户主同意且施工队有资质）" :image-size="60" />

      <el-button v-if="canPlan" type="primary" plain size="small" style="margin-top:8px" @click="showPlan=true">
        {{ archive.constructionPlan ? '修改/重新提交施工计划' : '提交施工计划与预算' }}
      </el-button>
    </el-card>

    <!-- 施工过程 -->
    <el-card shadow="never" style="margin-top:12px">
      <template #header>施工过程：材料 · 照片 · 阶段进度（进场材料与预算规格自动比对）</template>
      <el-table :data="archive.constructionLogs" size="small" border>
        <el-table-column prop="recordedAt" label="时间" width="160"><template #default="{row}">{{ fmtDate(row.recordedAt) }}</template></el-table-column>
        <el-table-column prop="stage" label="阶段" width="120" />
        <el-table-column prop="content" label="内容" min-width="200" />
        <el-table-column label="进场材料" width="180">
          <template #default="{ row }">
            <span v-if="row.materialName">{{ row.materialName }} {{ row.materialSpec }}</span><span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="核验" width="90">
          <template #default="{ row }">
            <el-tag v-if="row.materialName" size="small" :type="row.materialVerified?'success':'danger'">{{ row.materialVerified?'相符':'不符' }}</el-tag>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column label="进度" width="130"><template #default="{row}"><el-progress :percentage="row.progressPercent" :stroke-width="12" /></template></el-table-column>
      </el-table>
      <el-button v-if="canLog" type="primary" size="small" style="margin-top:8px" @click="showLog=true">上报施工进度/材料</el-button>
    </el-card>

    <!-- 施工计划弹窗 -->
    <el-dialog v-model="showPlan" title="施工计划与预算" width="760px">
      <el-form :model="planForm" label-width="90px">
        <el-form-item label="施工队">
          <el-select v-model="planForm.teamId" style="width:100%">
            <el-option v-for="t in teams" :key="t.id" :value="t.id" :disabled="t.restricted"
              :label="`${t.name}（资质：${t.qualificationNo||'无'}${t.qualified?' 有效':' 已失效'}${t.restricted?' 限制接单':''}）`" />
          </el-select>
        </el-form-item>
        <el-form-item label="工期">
          <el-date-picker v-model="planForm.startDate" type="date" value-format="YYYY-MM-DD" placeholder="开始" />
          <span style="margin:0 8px">~</span>
          <el-date-picker v-model="planForm.endDate" type="date" value-format="YYYY-MM-DD" placeholder="结束" />
        </el-form-item>
        <el-form-item label="施工说明"><el-input v-model="planForm.description" /></el-form-item>
        <el-divider>预算明细（材料名称与规格将作为进场核验依据）</el-divider>
        <el-table :data="planForm.budgetItems" size="small">
          <el-table-column label="名称"><template #default="{row}"><el-input v-model="row.name" size="small" /></template></el-table-column>
          <el-table-column label="规格" width="150"><template #default="{row}"><el-input v-model="row.spec" size="small" /></template></el-table-column>
          <el-table-column label="数量" width="100"><template #default="{row}"><el-input-number v-model="row.qty" :min="0" size="small" controls-position="right" style="width:90px" /></template></el-table-column>
          <el-table-column label="单位" width="70"><template #default="{row}"><el-input v-model="row.unit" size="small" /></template></el-table-column>
          <el-table-column label="单价" width="100"><template #default="{row}"><el-input-number v-model="row.unitPrice" :min="0" size="small" controls-position="right" style="width:90px" /></template></el-table-column>
          <el-table-column label="操作" width="60"><template #default="{$index}"><el-button link type="danger" @click="planForm.budgetItems.splice($index,1)">删</el-button></template></el-table-column>
        </el-table>
        <el-button size="small" style="margin-top:8px" @click="planForm.budgetItems.push({name:'',spec:'',qty:1,unit:'项',unitPrice:0})">+ 增加明细</el-button>
      </el-form>
      <template #footer>
        <el-button @click="showPlan=false">取消</el-button>
        <el-button type="primary" @click="submitPlan">提交（系统将校验告知/停用/同意书/资质/预算）</el-button>
      </template>
    </el-dialog>

    <!-- 施工日志弹窗 -->
    <el-dialog v-model="showLog" title="上报施工进度" width="600px">
      <el-form :model="logForm" label-width="100px">
        <el-form-item label="施工阶段">
          <el-select v-model="logForm.stage" style="width:100%">
            <el-option v-for="(v,k) in ITEM_TYPES" :key="k" :label="v" :value="v" />
          </el-select>
        </el-form-item>
        <el-form-item label="进度内容"><el-input v-model="logForm.content" type="textarea" :rows="3" /></el-form-item>
        <el-form-item label="进场材料名"><el-input v-model="logForm.materialName" placeholder="如：防水卷材 / 钢筋 / 商品混凝土" /></el-form-item>
        <el-form-item label="材料规格"><el-input v-model="logForm.materialSpec" placeholder="如：SBS 4mm，与预算不一致将判定偷换材料" /></el-form-item>
        <el-form-item label="阶段进度"><el-slider v-model="logForm.progressPercent" show-input /></el-form-item>
        <el-form-item label="关联整改项">
          <el-select v-model="logForm.itemId" clearable style="width:100%">
            <el-option v-for="it in latestItems" :key="it.id" :value="it.id" :label="`${ITEM_TYPES[it.type]}（材料相符时同步施工状态）`" />
          </el-select>
        </el-form-item>
        <el-form-item label="现场照片">
          <el-upload :action="uploadUrl" :headers="headers" :on-success="(r)=>logForm.photos.push(r.url)" :show-file-list="false">
            <el-button size="small">上传照片</el-button>
          </el-upload>
          <el-tag v-for="(u,i) in logForm.photos" :key="i" closable size="small" style="margin:4px 4px 0" @close="logForm.photos.splice(i,1)">照片{{i+1}}</el-tag>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showLog=false">取消</el-button>
        <el-button type="primary" @click="submitLog">提交进度</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import http from '../api';
import { DIFFICULTY, ITEM_TYPES, fmtDate } from '../labels';
import { useAuthStore } from '../store';

const props = defineProps(['archive']);
const emit = defineEmits(['reload']);
const auth = useAuthStore();
const uploadUrl = '/api/upload';
const headers = computed(() => ({ Authorization: `Bearer ${localStorage.getItem('rhs_token')}` }));
const canEditFamily = ['FARMER', 'GRID_WORKER', 'TOWNSHIP_REVIEWER', 'COUNTY_ADMIN'].includes(auth.role);
const canPlan = ['FARMER', 'TOWNSHIP_REVIEWER', 'COUNTY_ADMIN'].includes(auth.role);
const canLog = ['TEAM', 'TOWNSHIP_REVIEWER', 'GRID_WORKER', 'COUNTY_ADMIN'].includes(auth.role);
const latestItems = computed(() => props.archive.plans?.[0]?.items || []);

const fam = reactive({ difficultyType: 'NONE', difficultyProof: [], ownershipType: '自有（宅基地）', ownershipProof: [], ownerConsent: false, membersNote: '' });
const teams = ref([]);
const showPlan = ref(false);
const showLog = ref(false);
const planForm = reactive({ teamId: '', startDate: '', endDate: '', description: '', budgetItems: [] });
const logForm = reactive({ stage: '加固承重墙', content: '', materialName: '', materialSpec: '', progressPercent: 10, photos: [], itemId: '' });

function syncFam() {
  const f = props.archive.family;
  if (f) Object.assign(fam, { difficultyType: f.difficultyType, difficultyProof: [...(f.difficultyProof||[])], ownershipType: f.ownershipType, ownershipProof: [...(f.ownershipProof||[])], ownerConsent: f.ownerConsent, membersNote: f.membersNote || '' });
  if (props.archive.constructionPlan?.teamId) planForm.teamId = props.archive.constructionPlan.teamId;
}
onMounted(async () => {
  syncFam();
  const { data } = await http.get('/api/teams');
  teams.value = data;
});
watch(() => props.archive.family, syncFam);

async function saveFamily() {
  await http.post(`/api/houses/${props.archive.house.id}/family`, fam);
  ElMessage.success('家庭与权属信息已保存');
  emit('reload');
}
async function submitPlan() {
  if (!planForm.budgetItems.length) return ElMessage.warning('请添加预算明细');
  await http.post('/api/construction-plans', { houseId: props.archive.house.id, ...planForm });
  ElMessage.success('施工计划已提交');
  showPlan.value = false;
  emit('reload');
}
async function submitLog() {
  const payload = { houseId: props.archive.house.id, ...logForm };
  if (!payload.itemId) delete payload.itemId;
  await http.post('/api/construction-logs', payload);
  ElMessage.success('施工进度已上报');
  showLog.value = false;
  Object.assign(logForm, { content: '', materialName: '', materialSpec: '', progressPercent: 10, photos: [], itemId: '' });
  emit('reload');
}
</script>
