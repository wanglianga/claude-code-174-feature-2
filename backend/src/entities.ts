import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';

// ---------- 枚举 ----------
export enum UserRole {
  GRID_WORKER = 'GRID_WORKER', // 网格员
  TOWNSHIP_REVIEWER = 'TOWNSHIP_REVIEWER', // 乡镇住建人员
  COUNTY_ADMIN = 'COUNTY_ADMIN', // 县级主管部门
  FARMER = 'FARMER', // 农户
  TEAM = 'TEAM', // 施工队
  ACCEPTOR = 'ACCEPTOR', // 验收人员
}

export enum RiskLevel {
  NORMAL = 'NORMAL', // 一般关注
  RECTIFY = 'RECTIFY', // 限期整改
  SUSPEND = 'SUSPEND', // 暂停使用
  EVACUATE = 'EVACUATE', // 紧急转移
}

export enum HouseStatus {
  PENDING_REVIEW = 'PENDING_REVIEW', // 待复核
  IN_PLAN = 'IN_PLAN', // 已复核/方案中
  NOTIFIED = 'NOTIFIED', // 已告知
  STOPPED = 'STOPPED', // 已停用
  EVACUATED = 'EVACUATED', // 已转移
  RECTIFYING = 'RECTIFYING', // 整改中
  REWORK = 'REWORK', // 材料抽查偷换属实，退回返工
  PENDING_ACCEPTANCE = 'PENDING_ACCEPTANCE', // 待验收（实际为验收通过待销号）
  ACCEPTANCE_FAILED = 'ACCEPTANCE_FAILED', // 验收不通过
  CLOSED = 'CLOSED', // 已销号
  REBOUND = 'REBOUND', // 复查反弹/重新治理
  REFUSED = 'REFUSED', // 农户拒绝整改
}

export enum ItemType {
  REMOVE_ILLEGAL_FLOOR = 'REMOVE_ILLEGAL_FLOOR', // 拆除违建加层
  REINFORCE_WALL = 'REINFORCE_WALL', // 加固承重墙
  REPAIR_ROOF = 'REPAIR_ROOF', // 修复屋面
  EVICT_TENANTS = 'EVICT_TENANTS', // 清退经营租户
  SET_WARNING = 'SET_WARNING', // 设置警示
  TEMP_RESETTLEMENT = 'TEMP_RESETTLEMENT', // 安排临时安置
}

export enum ItemStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  DONE = 'DONE',
  FAILED = 'FAILED',
}

export enum IssueType {
  FARMER_REFUSE = 'FARMER_REFUSE', // 农户拒绝整改
  MATERIAL_SWAP = 'MATERIAL_SWAP', // 施工队偷换材料
  SUBSIDY_DISPUTE = 'SUBSIDY_DISPUTE', // 补助资格争议
  RAIN_SEASON = 'RAIN_SEASON', // 雨季风险加重
  TENANT_REFUSE = 'TENANT_REFUSE', // 租户不愿搬离
  ACCEPTANCE_FAIL = 'ACCEPTANCE_FAIL', // 验收不通过
  REBOUND = 'REBOUND', // 复查发现问题反弹
}

export enum IssueStatus {
  OPEN = 'OPEN',
  RESOLVING = 'RESOLVING',
  RESOLVED = 'RESOLVED',
}

export enum StakeholderType {
  OWNER = 'OWNER', // 户主
  TENANT = 'TENANT', // 租户
  OPERATOR = 'OPERATOR', // 经营者
  ELDER = 'ELDER', // 老人家庭成员
  CADRE = 'CADRE', // 村干部
}

export enum Stance {
  SUPPORT = 'SUPPORT',
  NEUTRAL = 'NEUTRAL',
  OPPOSE = 'OPPOSE',
  UNKNOWN = 'UNKNOWN',
}

export enum DifficultyType {
  NONE = 'NONE',
  LOW_INCOME = 'LOW_INCOME', // 低保
  FIVE_GUARANTEE = 'FIVE_GUARANTEE', // 五保
  DISABLED = 'DISABLED', // 残疾
  MONITORING = 'MONITORING', // 防止返贫监测户
  VETERAN = 'VETERAN', // 优抚对象
}

export enum SubsidyStatus {
  DRAFT = 'DRAFT',
  SUBMITTED = 'SUBMITTED',
  APPROVED = 'APPROVED',
  SUSPENDED = 'SUSPENDED', // 材料偷换属实，补助拨付暂停（返工复验通过后恢复为已批准）
  REJECTED = 'REJECTED',
  PAID = 'PAID',
}

export enum AcceptanceResult {
  PASS = 'PASS',
  FAIL = 'FAIL',
}

// 材料抽查状态
export enum MaterialCheckStatus {
  OPEN = 'OPEN', // 验收人员发起抽查，等待施工队举证
  EVIDENCE_SUBMITTED = 'EVIDENCE_SUBMITTED', // 施工队已提交发票/进场照片/现场测量结果，待判定
  CONFIRMED_SWAP = 'CONFIRMED_SWAP', // 偷换属实
  CLEARED = 'CLEARED', // 澄清合格（规格与方案一致）
  REWORKED = 'REWORKED', // 偷换后已返工并重新提交整改
}

// 抽查判定
export enum MaterialCheckVerdict {
  SWAP = 'SWAP', // 偷换属实
  MATCH = 'MATCH', // 比对一致，澄清
}

// ---------- 用户 ----------
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column({ unique: true })
  username: string;
  @Column()
  passwordHash: string;
  @Column()
  name: string;
  @Column({ type: 'varchar', length: 32 })
  role: UserRole;
  @Column({ nullable: true })
  township: string; // 所属乡镇
  @Column({ nullable: true })
  phone: string;
  @Column({ nullable: true })
  teamId: string;
}

// ---------- 房屋（档案主表）----------
@Entity('houses')
export class House {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column({ unique: true })
  code: string; // 房屋档案编号
  @Column()
  township: string; // 乡镇
  @Column()
  village: string; // 行政村
  @Column()
  address: string;
  @Column({ type: 'float', nullable: true })
  lng: number;
  @Column({ type: 'float', nullable: true })
  lat: number;
  @Column()
  ownerName: string;
  @Column({ nullable: true })
  idCard: string;
  @Column({ nullable: true })
  ownerPhone: string;

  // 巡查登记的房屋属性（以最新巡查为准）
  @Column({ type: 'int' })
  buildYear: number;
  @Column({ type: 'int' })
  floors: number;
  @Column({ default: '住宅' })
  usage: string; // 使用用途
  @Column({ default: false })
  isBusiness: boolean; // 是否经营
  @Column({ default: false })
  isRented: boolean; // 是否出租
  @Column({ default: false })
  isAddedFloor: boolean; // 是否加层（疑似违建加层）
  @Column({ type: 'int', default: 0 })
  wallCrack: number; // 墙体裂缝 0无 1明显 2严重
  @Column({ type: 'int', default: 0 })
  roofLeak: number; // 屋面渗漏 0无 1局部 2严重
  @Column({ type: 'int', default: 0 })
  foundationSettlement: number; // 地基沉降 0无 1明显 2严重
  @Column({ type: 'int', default: 0 })
  residents: number; // 居住人数

  @Column({ type: 'varchar', length: 16, default: RiskLevel.NORMAL })
  riskLevel: RiskLevel;
  @Column({ type: 'varchar', length: 32, default: HouseStatus.PENDING_REVIEW })
  status: HouseStatus;
  @Column({ type: 'simple-json', nullable: true })
  ruleReasons: string[]; // 最新风险判定依据
  @Column({ default: false })
  stopUseConfirmed: boolean; // 是否已确认停用（封停/警示核查）
  @CreateDateColumn()
  createdAt: Date;
}

// ---------- 巡查记录 ----------
@Entity('inspections')
export class Inspection {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @ManyToOne(() => House, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'houseId' })
  house: House;
  @Column()
  houseId: string;
  @Column()
  inspectorId: string;
  @Column({ nullable: true })
  inspectorName: string;
  @Column({ type: 'timestamptz' })
  inspectedAt: Date;
  @Column({ type: 'int' })
  buildYear: number;
  @Column({ type: 'int' })
  floors: number;
  @Column()
  usage: string;
  @Column({ default: false })
  isBusiness: boolean;
  @Column({ default: false })
  isRented: boolean;
  @Column({ default: false })
  isAddedFloor: boolean;
  @Column({ type: 'int', default: 0 })
  wallCrack: number;
  @Column({ type: 'int', default: 0 })
  roofLeak: number;
  @Column({ type: 'int', default: 0 })
  foundationSettlement: number;
  @Column({ type: 'int', default: 0 })
  residents: number;
  @Column({ default: false })
  rainSeason: boolean; // 巡查时正值雨季/降雨后险情加重
  @Column({ type: 'varchar', length: 16 })
  riskLevel: RiskLevel;
  @Column({ type: 'simple-json' })
  reasons: string[];
  @Column({ type: 'simple-json', nullable: true })
  photos: string[];
  @Column({ type: 'text', nullable: true })
  notes: string;
  @CreateDateColumn()
  createdAt: Date;
}

// ---------- 复核与整改方案 ----------
@Entity('review_plans')
export class ReviewPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column()
  inspectionId: string;
  @Column()
  reviewerId: string;
  @Column({ nullable: true })
  reviewerName: string;
  @Column({ type: 'timestamptz' })
  reviewedAt: Date;
  @Column({ type: 'varchar', length: 16 })
  decision: RiskLevel; // 复核确认的风险等级
  @Column({ type: 'text', nullable: true })
  requirement: string; // 整改总体要求
  @Column({ type: 'date' })
  deadline: string; // 整改期限
  @Column({ default: false })
  stopUseRequired: boolean; // 必须暂停使用
  @Column({ default: false })
  evacuationRequired: boolean; // 必须紧急转移
  @OneToMany(() => RectificationItem, (i) => i.plan, { cascade: true })
  items: RectificationItem[];
  @CreateDateColumn()
  createdAt: Date;
}

@Entity('rectification_items')
export class RectificationItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @ManyToOne(() => ReviewPlan, (p) => p.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'planId' })
  plan: ReviewPlan;
  @Column()
  planId: string;
  @Column({ type: 'varchar', length: 32 })
  type: ItemType;
  @Column({ type: 'text' })
  description: string;
  @Column({ default: true })
  required: boolean;
  @Column({ type: 'varchar', length: 16, default: ItemStatus.PENDING })
  status: ItemStatus;
}

// ---------- 风险告知 ----------
@Entity('notice_records')
export class NoticeRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column({ nullable: true })
  planId: string;
  @Column()
  method: string; // 书面送达 / 现场告知 / 电话告知
  @Column({ type: 'simple-json' })
  notifiedTo: string[]; // 被告知人：户主、租户、经营者
  @Column({ type: 'timestamptz' })
  notifiedAt: Date;
  @Column({ default: false })
  acknowledged: boolean; // 是否签收确认
  @Column({ type: 'simple-json', nullable: true })
  signPhotos: string[];
  @Column({ type: 'text', nullable: true })
  content: string;
  @Column()
  recorderId: string;
}

// ---------- 人员转移与临时安置 ----------
@Entity('evacuation_records')
export class EvacuationRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column({ type: 'int' })
  residents: number; // 实际转移人数
  @Column()
  destination: string; // 投亲靠友 / 村部安置点 / 乡镇集中安置点
  @Column({ type: 'simple-json', nullable: true })
  photos: string[];
  @Column({ type: 'timestamptz' })
  settledAt: Date;
  @Column({ type: 'timestamptz', nullable: true })
  returnedAt: Date; // 安全整改后返回时间
  @Column({ default: false })
  allowReturn: boolean; // 是否准许返回（验收通过前不得返回）
  @Column()
  recorderId: string;
  @Column({ type: 'text', nullable: true })
  remark: string;
}

// ---------- 利益相关方与协商 ----------
@Entity('stakeholders')
export class Stakeholder {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column({ type: 'varchar', length: 16 })
  type: StakeholderType;
  @Column()
  name: string;
  @Column({ nullable: true })
  phone: string;
  @Column({ type: 'varchar', length: 16, default: Stance.UNKNOWN })
  stance: Stance;
  @Column({ type: 'text', nullable: true })
  influenceNote: string; // 对整改进度的影响（如老人不愿搬、租户租期未到）
}

@Entity('consultations')
export class Consultation {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column()
  topic: string;
  @Column({ type: 'simple-json' })
  attendeeIds: string[];
  @Column({ type: 'text' })
  outcome: string; // 协商结果
  @Column({ type: 'timestamptz' })
  heldAt: Date;
  @Column()
  recorderId: string;
}

// ---------- 异常事件 ----------
@Entity('issue_records')
export class IssueRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column({ type: 'varchar', length: 32 })
  type: IssueType;
  @Column({ type: 'text' })
  description: string;
  @Column({ type: 'varchar', length: 16, default: IssueStatus.OPEN })
  status: IssueStatus;
  @Column({ type: 'boolean', default: false })
  blocksWorkflow: boolean; // 是否阻断当前环节
  @Column()
  raisedById: string;
  @Column({ nullable: true })
  raisedByName: string;
  @Column({ type: 'timestamptz' })
  raisedAt: Date;
  @Column({ type: 'text', nullable: true })
  resolution: string;
  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date;
}

// ---------- 家庭困难类型与房屋权属 ----------
@Entity('family_profiles')
export class FamilyProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column({ unique: true })
  houseId: string;
  @Column({ type: 'varchar', length: 24, default: DifficultyType.NONE })
  difficultyType: DifficultyType;
  @Column({ type: 'simple-json', nullable: true })
  difficultyProof: string[]; // 困难证明材料
  @Column({ default: '自有' })
  ownershipType: string; // 自有/继承/共有
  @Column({ type: 'simple-json', nullable: true })
  ownershipProof: string[]; // 权属证明材料
  @Column({ default: false })
  ownerConsent: boolean; // 户主是否同意整改
  @Column({ type: 'text', nullable: true })
  membersNote: string; // 家庭成员情况（老人、病患等）
}

// ---------- 施工队 ----------
@Entity('construction_teams')
export class ConstructionTeam {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  name: string;
  @Column({ nullable: true })
  qualificationNo: string; // 资质证书编号
  @Column({ type: 'simple-json', nullable: true })
  qualificationDoc: string[];
  @Column({ default: false })
  qualified: boolean; // 资质是否在有效期内且与施工内容相符
  @Column({ nullable: true })
  contact: string;
  @Column({ nullable: true })
  phone: string;
  @Column({ type: 'text', nullable: true })
  scope: string;
  @Column({ default: false })
  restricted: boolean; // 是否列入限制接单名单（偷换材料属实）
  @Column({ type: 'text', nullable: true })
  restrictReason: string; // 限制接单原因
  @Column({ type: 'timestamptz', nullable: true })
  restrictedAt: Date;
  @Column({ type: 'timestamptz', nullable: true })
  restrictLiftedAt: Date; // 解除限制时间
}

// ---------- 施工计划与预算明细 ----------
@Entity('construction_plans')
export class ConstructionPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column({ unique: true })
  houseId: string;
  @Column({ nullable: true })
  teamId: string;
  @Column({ nullable: true })
  teamName: string;
  @Column({ type: 'date' })
  startDate: string;
  @Column({ type: 'date' })
  endDate: string;
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  budgetTotal: string;
  @Column({ type: 'text', nullable: true })
  description: string;
  @OneToMany(() => BudgetItem, (b) => b.plan, { cascade: true })
  budgetItems: BudgetItem[];
  @CreateDateColumn()
  createdAt: Date;
}

@Entity('budget_items')
export class BudgetItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @ManyToOne(() => ConstructionPlan, (p) => p.budgetItems, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'planId' })
  plan: ConstructionPlan;
  @Column()
  planId: string;
  @Column()
  name: string; // 材料/工程项目
  @Column({ nullable: true })
  spec: string; // 规格型号（材料核验依据）
  @Column({ type: 'float' })
  qty: number;
  @Column()
  unit: string;
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  unitPrice: string;
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount: string;
}

// ---------- 补助申请 ----------
@Entity('subsidy_applications')
export class SubsidyApplication {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column({ unique: true })
  houseId: string;
  @Column({ nullable: true })
  planId: string;
  @Column({ type: 'numeric', precision: 12, scale: 2, default: 0 })
  amount: string;
  @Column({ type: 'varchar', length: 24, default: DifficultyType.NONE })
  difficultyType: DifficultyType;
  @Column({ type: 'varchar', length: 16, default: SubsidyStatus.DRAFT })
  status: SubsidyStatus;
  @Column({ type: 'simple-json', nullable: true })
  guardResults: { passed: boolean; label: string; ok: boolean; message: string }[];
  @Column({ type: 'text', nullable: true })
  reviewComment: string;
  @Column({ nullable: true })
  reviewedById: string;
  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date;
  @Column({ type: 'timestamptz', nullable: true })
  paidAt: Date;
  @CreateDateColumn()
  createdAt: Date;
}

// ---------- 施工过程（材料/照片/阶段进度）----------
@Entity('construction_logs')
export class ConstructionLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column()
  stage: string; // 拆除加层/墙体加固/屋面修复/清退/警示安置/自检
  @Column({ type: 'text' })
  content: string;
  @Column({ nullable: true })
  materialName: string; // 实际使用材料
  @Column({ nullable: true })
  materialSpec: string; // 实际规格（与预算明细比对）
  @Column({ type: 'simple-json', nullable: true })
  photos: string[];
  @Column({ type: 'int', default: 0 })
  progressPercent: number;
  @Column({ default: false })
  materialVerified: boolean; // 材料与预算是否一致
  @Column({ type: 'timestamptz' })
  recordedAt: Date;
  @Column({ nullable: true })
  recorderId: string;
}

// ---------- 验收 ----------
@Entity('acceptances')
export class Acceptance {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column()
  planId: string;
  @Column()
  inspectorId: string;
  @Column({ nullable: true })
  inspectorName: string;
  @Column({ type: 'timestamptz' })
  acceptedAt: Date;
  @Column({ type: 'varchar', length: 8 })
  overall: AcceptanceResult;
  @Column({ type: 'text', nullable: true })
  comment: string;
  @OneToMany(() => AcceptanceItemResult, (r) => r.acceptance, { cascade: true })
  itemResults: AcceptanceItemResult[];
}

@Entity('acceptance_item_results')
export class AcceptanceItemResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @ManyToOne(() => Acceptance, (a) => a.itemResults, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'acceptanceId' })
  acceptance: Acceptance;
  @Column()
  acceptanceId: string;
  @Column()
  itemId: string;
  @Column({ type: 'varchar', length: 64 })
  itemType: string;
  @Column({ type: 'varchar', length: 8 })
  result: AcceptanceResult;
  @Column({ type: 'text', nullable: true })
  note: string;
  @Column({ type: 'simple-json', nullable: true })
  photos: string[];
}

// ---------- 施工材料抽查 ----------
@Entity('material_checks')
export class MaterialCheck {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column()
  teamId: string;
  @Column({ nullable: true })
  teamName: string;
  @Column()
  raisedById: string; // 发起抽查的验收人员
  @Column({ nullable: true })
  raisedByName: string;
  @Column({ type: 'timestamptz' })
  raisedAt: Date;
  @Column({ type: 'varchar', length: 32, default: MaterialCheckStatus.OPEN })
  status: MaterialCheckStatus;

  // 抽查发现（验收人员填写，如：钢梁规格与方案不一致）
  @Column({ type: 'text' })
  suspectItem: string; // 被抽查材料/部位，如 钢梁
  @Column({ nullable: true })
  planSpec: string; // 方案/预算要求规格
  @Column({ nullable: true })
  foundSpec: string; // 现场发现规格
  @Column({ type: 'text', nullable: true })
  suspectNote: string;
  @Column({ type: 'simple-json', nullable: true })
  completionPhotos: string[]; // 施工队提交的加固完成照片（抽查发起依据）

  // 施工队举证三要素
  @Column({ type: 'simple-json', nullable: true })
  invoiceDocs: string[]; // 材料发票
  @Column({ type: 'simple-json', nullable: true })
  siteEntryPhotos: string[]; // 进场照片
  @Column({ type: 'text', nullable: true })
  measurementResult: string; // 现场测量结果（规格/尺寸实测数据）
  @Column({ type: 'simple-json', nullable: true })
  measurementPhotos: string[]; // 现场测量佐证照片
  @Column({ type: 'timestamptz', nullable: true })
  evidenceAt: Date;
  @Column({ nullable: true })
  evidenceById: string;

  // 验收人员判定
  @Column({ type: 'varchar', length: 8, nullable: true })
  verdict: MaterialCheckVerdict;
  @Column({ type: 'text', nullable: true })
  verdictNote: string;
  @Column({ type: 'timestamptz', nullable: true })
  verdictAt: Date;
  @Column({ nullable: true })
  verdictById: string;

  // 返工重排：新的验收节点与补助拨付计划
  @Column({ type: 'date', nullable: true })
  reworkDeadline: string; // 返工期限
  @Column({ type: 'date', nullable: true })
  newAcceptanceDate: string; // 重新安排的验收节点
  @Column({ type: 'date', nullable: true })
  newPayPlanDate: string; // 重新安排的补助拨付计划日期
  @Column({ type: 'timestamptz', nullable: true })
  scheduledAt: Date;

  // 施工队返工后重新提交
  @Column({ type: 'text', nullable: true })
  reworkSummary: string; // 返工情况说明
  @Column({ type: 'simple-json', nullable: true })
  reworkPhotos: string[]; // 返工后照片
  @Column({ type: 'simple-json', nullable: true })
  reworkMeasurement: string[]; // 返工后实测结果/材料合格证明
  @Column({ type: 'timestamptz', nullable: true })
  reworkSubmittedAt: Date;
}

// ---------- 销号 ----------
@Entity('close_records')
export class CloseRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column()
  acceptanceId: string;
  @Column({ type: 'timestamptz' })
  closedAt: Date;
  @Column()
  closedById: string;
  @Column({ default: false })
  confirmedStopUseLifted: boolean; // 停用措施按方案解除/房屋安全恢复确认
  @Column({ default: false })
  confirmedAllItems: boolean; // 整改项逐条完成
  @Column({ type: 'text', nullable: true })
  remark: string;
}

// ---------- 复查 ----------
@Entity('recheck_records')
export class RecheckRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column({ type: 'varchar', length: 8 })
  result: AcceptanceResult; // PASS 保持销号 / FAIL 问题反弹
  @Column({ type: 'text', nullable: true })
  reboundNotes: string;
  @Column({ type: 'int', nullable: true })
  wallCrack: number;
  @Column({ type: 'int', nullable: true })
  roofLeak: number;
  @Column({ type: 'int', nullable: true })
  foundationSettlement: number;
  @Column({ type: 'timestamptz' })
  checkedAt: Date;
  @Column()
  inspectorId: string;
}

// ---------- 档案活动时间线 ----------
@Entity('house_activities')
export class HouseActivity {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  @Column()
  houseId: string;
  @Column({ type: 'varchar', length: 32 })
  kind: string; // INSPECTION/REVIEW/NOTICE/EVACUATE/PLAN/SUBSIDY/MATERIAL/CONSTRUCTION/ACCEPTANCE/CLOSE/RECHECK/ISSUE/CONSULT/MATERIAL_CHECK
  @Column()
  title: string;
  @Column({ type: 'text', nullable: true })
  detail: string;
  @Column({ nullable: true })
  operatorId: string;
  @Column({ nullable: true })
  operatorName: string;
  @CreateDateColumn()
  createdAt: Date;
}
