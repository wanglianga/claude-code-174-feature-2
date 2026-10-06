<template>
  <el-card shadow="never">
    <template #header>
      施工队资质管理
      <el-button v-if="canEdit" type="primary" size="small" style="float:right" @click="show=true">新增施工队</el-button>
    </template>
    <el-table :data="rows" border size="small" v-loading="loading">
      <el-table-column prop="name" label="施工队名称" min-width="180" />
      <el-table-column prop="qualificationNo" label="资质证书编号" width="200" />
      <el-table-column label="资质状态" width="120">
        <template #default="{ row }"><el-tag :type="row.qualified?'success':'danger'">{{ row.qualified ? '有效' : '失效/无资质' }}</el-tag></template>
      </el-table-column>
      <el-table-column label="接单状态" width="150">
        <template #default="{ row }">
          <el-tag :type="row.restricted?'danger':'success'">{{ row.restricted ? '限制接单中' : '正常接单' }}</el-tag>
          <div v-if="row.restricted" class="hint" style="white-space:normal">{{ row.restrictReason }}</div>
        </template>
      </el-table-column>
      <el-table-column prop="scope" label="允许施工范围" min-width="180" />
      <el-table-column prop="contact" label="联系人" width="100" />
      <el-table-column prop="phone" label="电话" width="130" />
      <el-table-column v-if="canLift" label="操作" width="110">
        <template #default="{ row }">
          <el-button v-if="row.restricted" link type="warning" size="small" @click="lift(row)">解除限制</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="hint">无有效资质或被列入限制接单名单的施工队，无法被农户选择承接加固施工（后端强制校验）。限制接单由材料抽查判定偷换属实自动触发，须县级主管部门核验整改后解除。</div>

    <el-dialog v-model="show" title="新增施工队" width="560px">
      <el-form :model="form" label-width="120px">
        <el-form-item label="名称"><el-input v-model="form.name" /></el-form-item>
        <el-form-item label="资质证书编号"><el-input v-model="form.qualificationNo" /></el-form-item>
        <el-form-item label="资质有效"><el-switch v-model="form.qualified" /></el-form-item>
        <el-form-item label="施工范围"><el-input v-model="form.scope" /></el-form-item>
        <el-form-item label="联系人"><el-input v-model="form.contact" /></el-form-item>
        <el-form-item label="电话"><el-input v-model="form.phone" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="show=false">取消</el-button><el-button type="primary" @click="submit">保存</el-button></template>
    </el-dialog>
  </el-card>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import http from '../api';
import { useAuthStore } from '../store';
const auth = useAuthStore();
const canEdit = computed(() => ['COUNTY_ADMIN', 'TOWNSHIP_REVIEWER'].includes(auth.role));
const canLift = computed(() => auth.role === 'COUNTY_ADMIN');
const rows = ref([]);
const loading = ref(false);
const show = ref(false);
const form = reactive({ name: '', qualificationNo: '', qualified: true, scope: '', contact: '', phone: '' });
async function load() {
  loading.value = true;
  try { rows.value = (await http.get('/api/teams')).data; } finally { loading.value = false; }
}
async function submit() {
  await http.post('/api/teams', form);
  ElMessage.success('已保存');
  show.value = false;
  load();
}
async function lift(row) {
  const { value } = await ElMessageBox.prompt(`解除「${row.name}」限制接单，须确认其已完成偷换材料整改`, '解除限制接单', {
    inputPlaceholder: '核验/解除说明', inputType: 'textarea',
  });
  await http.post(`/api/teams/${row.id}/lift-restriction`, { note: value });
  ElMessage.success('已解除限制接单');
  load();
}
onMounted(load);
</script>
<style scoped>.hint{color:#909caa;font-size:12px;margin-top:8px}</style>
