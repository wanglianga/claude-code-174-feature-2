import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  Acceptance,
  AcceptanceItemResult,
  AcceptanceResult,
  BudgetItem,
  CloseRecord,
  ConstructionLog,
  ConstructionPlan,
  ConstructionTeam,
  Consultation,
  DifficultyType,
  EvacuationRecord,
  FamilyProfile,
  House,
  HouseActivity,
  HouseStatus,
  Inspection,
  IssueRecord,
  IssueStatus,
  IssueType,
  ItemStatus,
  MaterialCheck,
  MaterialCheckStatus,
  MaterialCheckVerdict,
  NoticeRecord,
  RectificationItem,
  RecheckRecord,
  ReviewPlan,
  RiskLevel,
  Stakeholder,
  SubsidyApplication,
  SubsidyStatus,
  User,
} from './entities';
import { evaluateRisk } from './risk.rules';

const SUBSIDY_RATE = 0.7; // 补助不超过核定预算的70%
const SUBSIDY_CAP = 50000; // 每户最高补助5万元

export interface CurrentUser {
  sub: string;
  username: string;
  name: string;
  role: string;
  township?: string;
  teamId?: string;
}

@Injectable()
export class AppService {
  constructor(
    @InjectRepository(House) private houses: Repository<House>,
    @InjectRepository(Inspection) private inspections: Repository<Inspection>,
    @InjectRepository(ReviewPlan) private plans: Repository<ReviewPlan>,
    @InjectRepository(RectificationItem) private items: Repository<RectificationItem>,
    @InjectRepository(NoticeRecord) private notices: Repository<NoticeRecord>,
    @InjectRepository(EvacuationRecord) private evacuations: Repository<EvacuationRecord>,
    @InjectRepository(Stakeholder) private stakeholders: Repository<Stakeholder>,
    @InjectRepository(Consultation) private consultations: Repository<Consultation>,
    @InjectRepository(IssueRecord) private issues: Repository<IssueRecord>,
    @InjectRepository(FamilyProfile) private families: Repository<FamilyProfile>,
    @InjectRepository(ConstructionTeam) private teams: Repository<ConstructionTeam>,
    @InjectRepository(ConstructionPlan) private cplans: Repository<ConstructionPlan>,
    @InjectRepository(BudgetItem) private budgetItems: Repository<BudgetItem>,
    @InjectRepository(SubsidyApplication) private subsidies: Repository<SubsidyApplication>,
    @InjectRepository(ConstructionLog) private logs: Repository<ConstructionLog>,
    @InjectRepository(Acceptance) private acceptances: Repository<Acceptance>,
    @InjectRepository(AcceptanceItemResult) private results: Repository<AcceptanceItemResult>,
    @InjectRepository(CloseRecord) private closes: Repository<CloseRecord>,
    @InjectRepository(RecheckRecord) private rechecks: Repository<RecheckRecord>,
    @InjectRepository(HouseActivity) private activities: Repository<HouseActivity>,
    @InjectRepository(MaterialCheck) private materialChecks: Repository<MaterialCheck>,
    @InjectRepository(User) private users: Repository<User>,
    private dataSource: DataSource,
  ) {}

  // ---------- 工具 ----------
  async logActivity(houseId: string, kind: string, title: string, detail: string, u?: CurrentUser) {
    await this.activities.save(
      this.activities.create({
        houseId,
        kind,
        title,
        detail,
        operatorId: u?.sub,
        operatorName: u?.name,
      }),
    );
  }

  async openBlockingIssues(houseId: string): Promise<IssueRecord[]> {
    return this.issues.find({ where: { houseId, blocksWorkflow: true, status: In([IssueStatus.OPEN, IssueStatus.RESOLVING]) } });
  }

  async assertNoBlocking(houseId: string, action: string) {
    const list = await this.openBlockingIssues(houseId);
    if (list.length) {
      throw new BadRequestException(
        `存在 ${list.length} 件未解决的阻断性问题（${list.map((i) => issueTypeLabel(i.type)).join('、')}），无法${action}；请先协商处理并办结`,
      );
    }
  }

  // 未结案的材料抽查（发起/待举证/偷换属实待返工）
  async openMaterialChecks(houseId: string): Promise<MaterialCheck[]> {
    return this.materialChecks.find({
      where: {
        houseId,
        status: In([MaterialCheckStatus.OPEN, MaterialCheckStatus.EVIDENCE_SUBMITTED, MaterialCheckStatus.CONFIRMED_SWAP]),
      },
      order: { raisedAt: 'DESC' },
    });
  }

  async assertNoOpenMaterialCheck(houseId: string, action: string) {
    const list = await this.openMaterialChecks(houseId);
    if (list.length) {
      const c = list[0];
      const map: Record<string, string> = {
        [MaterialCheckStatus.OPEN]: '材料抽查已发起，等待施工队上传发票/进场照片/现场测量结果',
        [MaterialCheckStatus.EVIDENCE_SUBMITTED]: '材料抽查举证已提交，等待验收人员判定',
        [MaterialCheckStatus.CONFIRMED_SWAP]: '偷换材料属实，房屋已退回返工，须重新整改并逐项复验',
      };
      throw new BadRequestException(`材料抽查未结案，无法${action}：${map[c.status] || '抽查处理中'}`);
    }
  }

  async getHouseOrFail(id: string) {
    const h = await this.houses.findOne({ where: { id } });
    if (!h) throw new NotFoundException('房屋档案不存在');
    return h;
  }

  async latestPlan(houseId: string) {
    const plans = await this.plans.find({ where: { houseId }, order: { reviewedAt: 'DESC' }, relations: ['items'] });
    return plans[0] || null;
  }

  // ---------- 巡查 ----------
  async createInspection(u: CurrentUser, body: any) {
    const required = ['township', 'village', 'address', 'ownerName', 'buildYear', 'floors'];
    for (const f of required) {
      if (body[f] === undefined || body[f] === null || body[f] === '') {
        throw new BadRequestException(`字段 ${f} 不能为空`);
      }
    }
    const { level, reasons } = evaluateRisk({
      buildYear: Number(body.buildYear),
      floors: Number(body.floors),
      isBusiness: !!body.isBusiness,
      isRented: !!body.isRented,
      isAddedFloor: !!body.isAddedFloor,
      wallCrack: Number(body.wallCrack || 0),
      roofLeak: Number(body.roofLeak || 0),
      foundationSettlement: Number(body.foundationSettlement || 0),
      residents: Number(body.residents || 0),
      rainSeason: !!body.rainSeason,
    });

    return this.dataSource.transaction(async (m) => {
      let house: House;
      if (body.houseId) {
        house = await m.findOne(House, { where: { id: body.houseId } });
        if (!house) throw new NotFoundException('房屋档案不存在');
      } else if (body.code) {
        house = await m.findOne(House, { where: { code: body.code } });
      }
      if (!house) {
        const code = body.code || `NF-${body.township.slice(0, 2)}-${Date.now().toString().slice(-6)}`;
        if (await m.findOne(House, { where: { code } })) throw new BadRequestException('档案编号已存在');
        house = m.create(House, { code });
      }
      Object.assign(house, {
        township: body.township,
        village: body.village,
        address: body.address,
        lng: body.lng ?? house.lng,
        lat: body.lat ?? house.lat,
        ownerName: body.ownerName,
        idCard: body.idCard ?? house.idCard,
        ownerPhone: body.ownerPhone ?? house.ownerPhone,
        buildYear: Number(body.buildYear),
        floors: Number(body.floors),
        usage: body.usage || '住宅',
        isBusiness: !!body.isBusiness,
        isRented: !!body.isRented,
        isAddedFloor: !!body.isAddedFloor,
        wallCrack: Number(body.wallCrack || 0),
        roofLeak: Number(body.roofLeak || 0),
        foundationSettlement: Number(body.foundationSettlement || 0),
        residents: Number(body.residents || 0),
        riskLevel: level,
        ruleReasons: reasons,
      });
      // 复查中反弹的房屋再次巡查且有风险 -> 重新进入待复核；已销号房屋巡查出新风险 -> 待复核
      if ([HouseStatus.CLOSED, HouseStatus.REBOUND].includes(house.status) && level !== RiskLevel.NORMAL) {
        house.status = HouseStatus.PENDING_REVIEW;
      } else if (!house.status || house.status === HouseStatus.CLOSED) {
        house.status = HouseStatus.PENDING_REVIEW;
      }
      house = await m.save(house);

      const insp = await m.save(
        m.create(Inspection, {
          houseId: house.id,
          inspectorId: u.sub,
          inspectorName: u.name,
          inspectedAt: body.inspectedAt ? new Date(body.inspectedAt) : new Date(),
          buildYear: house.buildYear,
          floors: house.floors,
          usage: house.usage,
          isBusiness: house.isBusiness,
          isRented: house.isRented,
          isAddedFloor: house.isAddedFloor,
          wallCrack: house.wallCrack,
          roofLeak: house.roofLeak,
          foundationSettlement: house.foundationSettlement,
          residents: house.residents,
          rainSeason: !!body.rainSeason,
          riskLevel: level,
          reasons,
          photos: body.photos || [],
          notes: body.notes || null,
        }),
      );

      await m.save(
        m.create(HouseActivity, {
          houseId: house.id,
          kind: 'INSPECTION',
          title: `巡查登记 · ${riskLabel(level)}`,
          detail: reasons.join('；'),
          operatorId: u.sub,
          operatorName: u.name,
        }),
      );
      if (body.rainSeason && (level === RiskLevel.SUSPEND || level === RiskLevel.EVACUATE)) {
        await m.save(
          m.create(IssueRecord, {
            houseId: house.id,
            type: IssueType.RAIN_SEASON,
            description: '雨季/强降雨后房屋险情加重，需加密监测并优先处置',
            status: IssueStatus.RESOLVING,
            blocksWorkflow: false, // 雨季是加严因素而非整改阻断项
            raisedById: u.sub,
            raisedByName: u.name,
            raisedAt: new Date(),
          }),
        );
      }
      return { house, inspection: insp };
    });
  }

  // ---------- 乡镇复核与整改方案 ----------
  async createReview(u: CurrentUser, body: any) {
    const insp = await this.inspections.findOne({ where: { id: body.inspectionId } });
    if (!insp) throw new BadRequestException('巡查记录不存在');
    const house = await this.getHouseOrFail(insp.houseId);
    if (![HouseStatus.PENDING_REVIEW, HouseStatus.REBOUND].includes(house.status)) {
      throw new BadRequestException('当前房屋状态不允许复核（仅待复核/反弹重新治理可复核）');
    }
    if (!body.items || !body.items.length) throw new BadRequestException('整改方案至少包含一个整改项');
    const decision: RiskLevel = body.decision || insp.riskLevel;

    return this.dataSource.transaction(async (m) => {
      const plan = await m.save(
        m.create(ReviewPlan, {
          houseId: house.id,
          inspectionId: insp.id,
          reviewerId: u.sub,
          reviewerName: u.name,
          reviewedAt: new Date(),
          decision,
          requirement: body.requirement || '',
          deadline: body.deadline,
          stopUseRequired: !!body.stopUseRequired || decision === RiskLevel.SUSPEND || decision === RiskLevel.EVACUATE,
          evacuationRequired: !!body.evacuationRequired || decision === RiskLevel.EVACUATE,
        }),
      );
      for (const it of body.items) {
        await m.save(
          m.create(RectificationItem, {
            planId: plan.id,
            type: it.type,
            description: it.description,
            required: it.required !== false,
            status: ItemStatus.PENDING,
          }),
        );
      }
      house.status = HouseStatus.IN_PLAN;
      house.riskLevel = decision;
      await m.save(house);
      await m.save(
        m.create(HouseActivity, {
          houseId: house.id,
          kind: 'REVIEW',
          title: `乡镇复核 · ${riskLabel(decision)}，下达整改方案（${body.items.length}项，期限 ${body.deadline}）`,
          detail: body.requirement || '',
          operatorId: u.sub,
          operatorName: u.name,
        }),
      );
      return m.findOne(ReviewPlan, { where: { id: plan.id }, relations: ['items'] });
    });
  }

  // ---------- 风险告知 ----------
  async createNotice(u: CurrentUser, body: any) {
    const house = await this.getHouseOrFail(body.houseId);
    const plan = await this.latestPlan(house.id);
    if (!plan) throw new BadRequestException('尚未形成复核整改方案，不能进行风险告知');
    if (!body.notifiedTo || !body.notifiedTo.length) throw new BadRequestException('请选择被告知对象');
    // 紧急转移/暂停使用房屋，告知必须签收，方可进入后续环节
    if ((plan.evacuationRequired || plan.stopUseRequired) && !body.acknowledged) {
      throw new BadRequestException('该房屋需暂停使用/紧急转移，风险告知必须由被告知人签收确认');
    }
    const notice = await this.notices.save(
      this.notices.create({
        houseId: house.id,
        planId: plan.id,
        method: body.method || '现场告知',
        notifiedTo: body.notifiedTo,
        notifiedAt: new Date(body.notifiedAt || Date.now()),
        acknowledged: !!body.acknowledged,
        signPhotos: body.signPhotos || [],
        content: body.content || plan.requirement,
        recorderId: u.sub,
      }),
    );
    house.status = HouseStatus.NOTIFIED;
    await this.houses.save(house);
    await this.logActivity(house.id, 'NOTICE', `风险告知（${notice.method}）`, `被告知人：${body.notifiedTo.join('、')}；${body.acknowledged ? '已签收' : '未签收'}`, u);
    return notice;
  }

  // ---------- 停用确认 / 人员转移 ----------
  async confirmStopUse(u: CurrentUser, houseId: string, body: any) {
    const house = await this.getHouseOrFail(houseId);
    const plan = await this.latestPlan(houseId);
    if (!plan) throw new BadRequestException('尚未下达整改方案');
    if (!plan.stopUseRequired && !plan.evacuationRequired) {
      throw new BadRequestException('方案未要求暂停使用，无需封停确认');
    }
    const ackNotice = await this.notices.findOne({ where: { houseId }, order: { notifiedAt: 'DESC' } });
    if (!ackNotice || !ackNotice.acknowledged) {
      throw new BadRequestException('风险告知未签收，不得采取封停措施');
    }
    house.stopUseConfirmed = !!body.confirmed;
    if (!plan.evacuationRequired) house.status = HouseStatus.STOPPED;
    await this.houses.save(house);
    await this.logActivity(houseId, 'NOTICE', body.confirmed ? '房屋已封停/设置警示，确认暂停使用' : '停用确认被撤销', body.remark || '', u);
    return { ok: true };
  }

  async createEvacuation(u: CurrentUser, body: any) {
    const house = await this.getHouseOrFail(body.houseId);
    const plan = await this.latestPlan(house.id);
    if (!plan) throw new BadRequestException('尚未下达整改方案');
    if (!plan.evacuationRequired && !body.force) {
      throw new BadRequestException('该房屋方案未要求紧急转移；如情况紧急请由乡镇确认后登记');
    }
    if (Number(body.residents) <= 0) throw new BadRequestException('转移人数必须大于0');
    if (!body.destination) throw new BadRequestException('请填写安置去向');
    const ackNotice = await this.notices.findOne({ where: { houseId: house.id }, order: { notifiedAt: 'DESC' } });
    if (!ackNotice?.acknowledged && !body.force) {
      throw new BadRequestException('风险告知未签收，不能登记转移（特殊情况可由乡镇强制处置并注明）');
    }
    return this.dataSource.transaction(async (m) => {
      const rec = await m.save(
        m.create(EvacuationRecord, {
          houseId: house.id,
          residents: Number(body.residents),
          destination: body.destination,
          photos: body.photos || [],
          settledAt: new Date(body.settledAt || Date.now()),
          allowReturn: false,
          recorderId: u.sub,
          remark: body.remark || '',
        }),
      );
      house.status = HouseStatus.EVACUATED;
      house.stopUseConfirmed = true;
      await m.save(house);
      await m.save(
        m.create(HouseActivity, {
          houseId: house.id,
          kind: 'EVACUATE',
          title: `紧急转移安置 ${rec.residents} 人 → ${rec.destination}`,
          detail: '验收通过并销号前，转移人员不得擅自返回',
          operatorId: u.sub,
          operatorName: u.name,
        }),
      );
      return rec;
    });
  }

  // ---------- 利益相关方 / 协商 / 异常 ----------
  async upsertStakeholder(houseId: string, body: any) {
    const rec = body.id
      ? await this.stakeholders.findOne({ where: { id: body.id } })
      : this.stakeholders.create({ houseId });
    if (!rec) throw new NotFoundException();
    Object.assign(rec, {
      type: body.type,
      name: body.name,
      phone: body.phone,
      stance: body.stance,
      influenceNote: body.influenceNote,
    });
    return this.stakeholders.save(rec);
  }

  async createConsultation(u: CurrentUser, body: any) {
    if (!body.outcome) throw new BadRequestException('请记录协商结果');
    const c = await this.consultations.save(
      this.consultations.create({
        houseId: body.houseId,
        topic: body.topic || '整改进度协商',
        attendeeIds: body.attendeeIds || [],
        outcome: body.outcome,
        heldAt: new Date(body.heldAt || Date.now()),
        recorderId: u.sub,
      }),
    );
    await this.logActivity(body.houseId, 'CONSULT', `多方协商：${c.topic}`, body.outcome, u);
    return c;
  }

  async raiseIssue(u: CurrentUser, body: any) {
    if (!body.type || !body.description) throw new BadRequestException('问题类型和描述不能为空');
    const issue = await this.issues.save(
      this.issues.create({
        houseId: body.houseId,
        type: body.type,
        description: body.description,
        status: IssueStatus.OPEN,
        blocksWorkflow: body.blocksWorkflow !== false,
        raisedById: u.sub,
        raisedByName: u.name,
        raisedAt: new Date(),
      }),
    );
    await this.logActivity(body.houseId, 'ISSUE', `异常上报：${issueTypeLabel(body.type)}`, body.description, u);
    return issue;
  }

  async setIssueStatus(u: CurrentUser, id: string, status: IssueStatus, resolution?: string) {
    const issue = await this.issues.findOne({ where: { id } });
    if (!issue) throw new NotFoundException();
    if (status === IssueStatus.RESOLVED && !resolution) {
      throw new BadRequestException('办结问题必须填写处置结果');
    }
    issue.status = status;
    if (resolution) issue.resolution = resolution;
    if (status === IssueStatus.RESOLVED) issue.resolvedAt = new Date();
    await this.issues.save(issue);
    await this.logActivity(
      issue.houseId,
      'ISSUE',
      status === IssueStatus.RESOLVED ? `问题办结：${issueTypeLabel(issue.type)}` : `问题处理中：${issueTypeLabel(issue.type)}`,
      resolution || '',
      u,
    );
    return issue;
  }

  // ---------- 家庭与权属 ----------
  async upsertFamily(houseId: string, body: any) {
    let f = await this.families.findOne({ where: { houseId } });
    if (!f) f = this.families.create({ houseId });
    Object.assign(f, {
      difficultyType: body.difficultyType || DifficultyType.NONE,
      difficultyProof: body.difficultyProof || [],
      ownershipType: body.ownershipType || '自有',
      ownershipProof: body.ownershipProof || [],
      ownerConsent: !!body.ownerConsent,
      membersNote: body.membersNote || '',
    });
    return this.families.save(f);
  }

  // ---------- 施工队 ----------
  listTeams() {
    return this.teams.find();
  }
  async createTeam(body: any) {
    if (!body.name) throw new BadRequestException('施工队名称不能为空');
    const t = this.teams.create({
      name: body.name,
      qualificationNo: body.qualificationNo || '',
      qualificationDoc: body.qualificationDoc || [],
      qualified: !!body.qualified,
      contact: body.contact,
      phone: body.phone,
      scope: body.scope,
    });
    return this.teams.save(t);
  }

  // ---------- 施工计划与预算 ----------
  async submitConstructionPlan(u: CurrentUser, body: any) {
    const house = await this.getHouseOrFail(body.houseId);
    const plan = await this.latestPlan(house.id);
    if (!plan) throw new BadRequestException('乡镇尚未形成整改方案');
    await this.assertNoBlocking(house.id, '提交施工计划');

    // 告知制约
    const notice = await this.notices.findOne({ where: { houseId: house.id }, order: { notifiedAt: 'DESC' } });
    if (!notice) throw new BadRequestException('尚未进行风险告知，不能开工');
    if ((plan.stopUseRequired || plan.evacuationRequired) && !notice.acknowledged) {
      throw new BadRequestException('风险告知未签收，不能开工');
    }
    // 停用/转移制约
    if (plan.evacuationRequired) {
      const evac = await this.evacuations.findOne({ where: { houseId: house.id }, order: { settledAt: 'DESC' } });
      if (!evac) throw new BadRequestException('紧急转移尚未落实，不能开工');
    } else if (plan.stopUseRequired && !house.stopUseConfirmed) {
      throw new BadRequestException('房屋尚未确认停用，不能开工');
    }
    // 户主同意
    const fam = await this.families.findOne({ where: { houseId: house.id } });
    if (!fam?.ownerConsent) throw new BadRequestException('户主尚未签署整改同意书（家庭情况登记中确认）');

    // 施工队资质
    const team = await this.teams.findOne({ where: { id: body.teamId } });
    if (!team) throw new BadRequestException('请选择施工队');
    if (!team.qualified || !team.qualificationNo) {
      throw new BadRequestException(`施工队「${team.name}」资质无效或已过期，不得承担农房加固施工`);
    }
    if (team.restricted) {
      throw new BadRequestException(`施工队「${team.name}」因偷换材料已被列入限制接单名单，解除前不得承接新的加固工程`);
    }

    // 预算明细
    if (!body.budgetItems || !body.budgetItems.length) throw new BadRequestException('请填写预算明细');
    let total = 0;
    for (const b of body.budgetItems) {
      if (!b.name || !(Number(b.qty) > 0) || !(Number(b.unitPrice) >= 0)) {
        throw new BadRequestException('预算明细存在空项或非法数量/单价');
      }
      total += Number(b.qty) * Number(b.unitPrice);
    }

    return this.dataSource.transaction(async (m) => {
      let cplan = await m.findOne(ConstructionPlan, { where: { houseId: house.id } });
      if (cplan) {
        await m.delete(BudgetItem, { planId: cplan.id });
      } else {
        cplan = m.create(ConstructionPlan, { houseId: house.id });
      }
      cplan.teamId = team.id;
      cplan.teamName = team.name;
      cplan.startDate = body.startDate;
      cplan.endDate = body.endDate;
      cplan.budgetTotal = total.toFixed(2);
      cplan.description = body.description || '';
      cplan = await m.save(cplan);
      for (const b of body.budgetItems) {
        const amount = Number(b.qty) * Number(b.unitPrice);
        await m.save(
          m.create(BudgetItem, {
            planId: cplan.id,
            name: b.name,
            spec: b.spec || '',
            qty: Number(b.qty),
            unit: b.unit,
            unitPrice: Number(b.unitPrice).toFixed(2),
            amount: amount.toFixed(2),
          }),
        );
      }
      house.status = HouseStatus.RECTIFYING;
      await m.save(house);
      await m.save(
        m.create(HouseActivity, {
          houseId: house.id,
          kind: 'PLAN',
          title: `施工计划与预算已提交（施工队：${team.name}，预算 ¥${total.toFixed(2)}）`,
          detail: `工期 ${body.startDate} 至 ${body.endDate}；共 ${body.budgetItems.length} 项明细`,
          operatorId: u.sub,
          operatorName: u.name,
        }),
      );
      return m.findOne(ConstructionPlan, { where: { id: cplan.id }, relations: ['budgetItems'] });
    });
  }

  // ---------- 补助申请（资格校验闸）----------
  async computeSubsidyGuards(house: House): Promise<{ passed: boolean; label: string; ok: boolean; message: string }[]> {
    const fam = await this.families.findOne({ where: { houseId: house.id } });
    const cplan = await this.cplans.findOne({ where: { houseId: house.id }, relations: ['budgetItems'] });
    const plan = await this.latestPlan(house.id);
    const notice = await this.notices.findOne({ where: { houseId: house.id }, order: { notifiedAt: 'DESC' } });
    const team = cplan?.teamId ? await this.teams.findOne({ where: { id: cplan.teamId } }) : null;
    const budget = cplan ? Number(cplan.budgetTotal) : 0;
    const openChecks = await this.openMaterialChecks(house.id);

    const guards = [
      {
        label: '家庭困难类型',
        ok: !!fam && fam.difficultyType !== DifficultyType.NONE,
        message: !fam ? '未登记家庭情况' : fam.difficultyType === DifficultyType.NONE ? '未认定困难类型，不符合补助条件' : `已认定：${difficultyLabel(fam.difficultyType)}`,
      },
      {
        label: '困难证明材料',
        ok: !!fam && (fam.difficultyProof?.length || 0) > 0,
        message: fam?.difficultyProof?.length ? `已上传 ${fam.difficultyProof.length} 份` : '缺少民政部门困难证明',
      },
      {
        label: '房屋权属证明',
        ok: !!fam && (fam.ownershipProof?.length || 0) > 0,
        message: fam?.ownershipProof?.length ? `已上传 ${fam.ownershipProof.length} 份` : '缺少不动产权证/宅基地使用证明',
      },
      {
        label: '户主整改同意',
        ok: !!fam?.ownerConsent,
        message: fam?.ownerConsent ? '户主已签署同意书' : '户主尚未同意整改',
      },
      {
        label: '整改方案与告知',
        ok: !!plan && !!notice,
        message: plan ? (notice ? '方案已下达并已告知' : '方案已下达但尚未告知') : '乡镇尚未下达整改方案',
      },
      {
        label: '高风险房屋停用/转移',
        ok: !plan || ((!plan.stopUseRequired || house.stopUseConfirmed) && (!plan.evacuationRequired ? true : false)) ||
          (plan.evacuationRequired && !!(await this.evacuations.findOne({ where: { houseId: house.id } }))),
        message: !plan?.evacuationRequired ? (plan?.stopUseRequired ? (house.stopUseConfirmed ? '已确认停用' : '应停用但未确认停用') : '方案未要求停用') : (await this.evacuations.findOne({ where: { houseId: house.id } })) ? '人员已转移安置' : '应紧急转移但尚未安置',
      },
      {
        label: '预算明细',
        ok: !!cplan && cplan.budgetItems.length > 0 && budget > 0,
        message: cplan ? (cplan.budgetItems.length ? `预算 ${cplan.budgetItems.length} 项，合计 ¥${budget.toFixed(2)}` : '预算明细为空') : '未提交施工预算',
      },
      {
        label: '施工队资质',
        ok: !!team?.qualified && !!team?.qualificationNo && !team?.restricted,
        message: !team ? '未选定施工队' : team.restricted ? `${team.name} 因偷换材料被列入限制接单名单` : team.qualified ? `${team.name}（资质 ${team.qualificationNo}）` : `${team.name} 资质失效`,
      },
      {
        label: '材料抽查',
        ok: openChecks.length === 0,
        message: openChecks.length ? `有 ${openChecks.length} 件材料抽查未结案（${materialCheckStatusLabel(openChecks[0].status)}），补助暂停` : '无未结案的材料抽查',
      },
    ];
    return guards.map((g) => ({ ...g, passed: g.ok }));
  }

  async submitSubsidy(u: CurrentUser, houseId: string, body: any) {
    const house = await this.getHouseOrFail(houseId);
    const guards = await this.computeSubsidyGuards(house);
    const allPass = guards.every((g) => g.ok);
    const cplan = await this.cplans.findOne({ where: { houseId } });
    const budget = cplan ? Number(cplan.budgetTotal) : 0;
    const maxAmount = Math.min(Math.round(budget * SUBSIDY_RATE), SUBSIDY_CAP);
    const amount = Math.min(Number(body.amount || 0), maxAmount);

    let app = await this.subsidies.findOne({ where: { houseId } });
    if (!app) app = this.subsidies.create({ houseId });
    app.amount = amount.toFixed(2);
    app.difficultyType = body.difficultyType || app.difficultyType || DifficultyType.NONE;
    app.guardResults = guards;
    app.planId = (await this.latestPlan(houseId))?.id;
    app.status = allPass ? SubsidyStatus.SUBMITTED : SubsidyStatus.DRAFT;
    app.reviewComment = allPass ? null : '资格校验未全部通过，退回补充材料';
    app = await this.subsidies.save(app);

    await this.logActivity(
      houseId,
      'SUBSIDY',
      allPass ? `补助申请已提交（¥${amount.toFixed(2)}，待乡镇复核）` : '补助申请资格校验未通过，退回补充',
      guards.filter((g) => !g.ok).map((g) => `${g.label}：${g.message}`).join('；') || '全部校验通过',
      u,
    );
    return { application: app, allPass, maxAmount };
  }

  async reviewSubsidy(u: CurrentUser, id: string, body: any) {
    const app = await this.subsidies.findOne({ where: { id } });
    if (!app) throw new NotFoundException();
    if (app.status !== SubsidyStatus.SUBMITTED) throw new BadRequestException('仅待复核的申请可审批');
    const disputes = await this.issues.find({
      where: { houseId: app.houseId, type: IssueType.SUBSIDY_DISPUTE, status: In([IssueStatus.OPEN, IssueStatus.RESOLVING]) },
    });
    if (disputes.length && body.approved) {
      throw new BadRequestException('该户存在未办结的补助资格争议，不得批准补助');
    }
    const openChecks = await this.openMaterialChecks(app.houseId);
    if (openChecks.length && body.approved) {
      throw new BadRequestException('该户存在未结案的施工材料抽查（疑似/已确认偷换材料），补助拨付暂停，不得批准');
    }
    app.status = body.approved ? SubsidyStatus.APPROVED : SubsidyStatus.REJECTED;
    app.reviewComment = body.comment || (body.approved ? '资格符合，同意补助' : '复核不通过');
    app.reviewedById = u.sub;
    app.reviewedAt = new Date();
    await this.subsidies.save(app);
    await this.logActivity(app.houseId, 'SUBSIDY', body.approved ? `补助申请已批准 ¥${app.amount}（验收销号后发放）` : '补助申请被驳回', app.reviewComment, u);
    return app;
  }

  async getSubsidyByHouse(houseId: string) {
    const app = await this.subsidies.findOne({ where: { houseId } });
    if (!app) throw new NotFoundException('该房屋暂无补助申请');
    return app;
  }

  /** 发放：必须在验收通过（销号）后，且申请已批准 */
  async paySubsidy(u: CurrentUser, id: string) {
    const app = await this.subsidies.findOne({ where: { id } });
    if (!app) throw new NotFoundException();
    if (app.status === SubsidyStatus.SUSPENDED) {
      throw new BadRequestException('该户补助因材料偷换属实已暂停拨付，须返工复验通过、恢复批准后再发放');
    }
    if (app.status !== SubsidyStatus.APPROVED) throw new BadRequestException('仅已批准的申请可发放');
    const openChecks = await this.openMaterialChecks(app.houseId);
    if (openChecks.length) throw new BadRequestException('存在未结案的材料抽查，补助暂停拨付');
    const close = await this.closes.findOne({ where: { houseId: app.houseId } });
    if (!close) throw new BadRequestException('房屋未完成验收销号，补助不得提前发放（防止“带病拨款”）');
    app.status = SubsidyStatus.PAID;
    app.paidAt = new Date();
    await this.subsidies.save(app);
    await this.logActivity(app.houseId, 'SUBSIDY', `补助资金已发放 ¥${app.amount}`, '验收销号后发放，符合条件家庭', u);
    return app;
  }

  // ---------- 施工过程 ----------
  async addConstructionLog(u: CurrentUser, body: any) {
    const house = await this.getHouseOrFail(body.houseId);
    const cplan = await this.cplans.findOne({ where: { houseId: house.id }, relations: ['budgetItems'] });
    if (!cplan) throw new BadRequestException('尚未提交施工计划');
    if (u.role === 'TEAM' && u.teamId && cplan.teamId !== u.teamId) {
      throw new ForbiddenException('该房屋不是本施工队承接的项目');
    }
    if (house.status === HouseStatus.CLOSED) throw new BadRequestException('房屋已销号');
    // 抽查发起后/待判定期间，施工队须走“举证/返工”通道，不能以普通进度上报绕过抽查
    const pendingCheck = (await this.openMaterialChecks(house.id))[0];
    if (pendingCheck && [MaterialCheckStatus.OPEN, MaterialCheckStatus.EVIDENCE_SUBMITTED].includes(pendingCheck.status)) {
      throw new BadRequestException(
        pendingCheck.status === MaterialCheckStatus.OPEN
          ? '该房屋材料抽查待举证：请上传材料发票、进场照片和现场测量结果，不能直接上报完工'
          : '材料抽查已举证，等待验收人员判定，暂不能上报新的施工进度',
      );
    }

    // 材料核验：实际材料名称/规格必须能在预算明细中找到，否则判定偷换材料
    let materialVerified = true;
    let swapDetail = '';
    if (body.materialName) {
      const hit = cplan.budgetItems.find(
        (b) => b.name === body.materialName && (!b.spec || !body.materialSpec || b.spec === body.materialSpec),
      );
      materialVerified = !!hit;
      if (!hit) {
        swapDetail = `现场使用「${body.materialName} ${body.materialSpec || ''}」与预算/方案列明材料不一致`;
      }
    }

    return this.dataSource.transaction(async (m) => {
      const log = await m.save(
        m.create(ConstructionLog, {
          houseId: house.id,
          stage: body.stage,
          content: body.content,
          materialName: body.materialName || null,
          materialSpec: body.materialSpec || null,
          photos: body.photos || [],
          progressPercent: Number(body.progressPercent || 0),
          materialVerified,
          recordedAt: new Date(body.recordedAt || Date.now()),
          recorderId: u.sub,
        }),
      );
      // 联动整改项状态
      if (body.itemId) {
        const item = await m.findOne(RectificationItem, { where: { id: body.itemId } });
        if (item) {
          item.status = body.itemStatus || (materialVerified ? ItemStatus.IN_PROGRESS : ItemStatus.PENDING);
          await m.save(item);
        }
      }
      if (!materialVerified) {
        await m.save(
          m.create(IssueRecord, {
            houseId: house.id,
            type: IssueType.MATERIAL_SWAP,
            description: swapDetail,
            status: IssueStatus.OPEN,
            blocksWorkflow: true,
            raisedById: u.sub,
            raisedByName: u.name,
            raisedAt: new Date(),
          }),
        );
      }
      // 返工阶段保持“返工中”状态，直到重新提交整改并复验通过
      if (house.status !== HouseStatus.REWORK) house.status = HouseStatus.RECTIFYING;
      await m.save(house);
      await m.save(
        m.create(HouseActivity, {
          houseId: house.id,
          kind: materialVerified ? 'CONSTRUCTION' : 'MATERIAL',
          title: materialVerified ? `施工进度上报：${body.stage}（${body.progressPercent || 0}%）` : `材料核验异常：${body.stage}`,
          detail: materialVerified ? body.content : `${swapDetail}；${body.content}`,
          operatorId: u.sub,
          operatorName: u.name,
        }),
      );
      return log;
    });
  }

  async setItemStatus(u: CurrentUser, itemId: string, status: ItemStatus) {
    const item = await this.items.findOne({ where: { id: itemId } });
    if (!item) throw new NotFoundException();
    item.status = status;
    await this.items.save(item);
    const plan = await this.plans.findOne({ where: { id: item.planId } });
    await this.logActivity(plan.houseId, 'CONSTRUCTION', `整改项「${itemTypeLabel(item.type)}」标记为${itemStatusLabel(status)}`, item.description, u);
    return item;
  }

  // ---------- 验收（逐条确认）----------
  async createAcceptance(u: CurrentUser, body: any) {
    const house = await this.getHouseOrFail(body.houseId);
    const plan = await this.latestPlan(house.id);
    if (!plan) throw new BadRequestException('没有整改方案');
    if (house.status === HouseStatus.CLOSED) throw new BadRequestException('房屋已销号');
    await this.assertNoBlocking(house.id, '组织验收');
    await this.assertNoOpenMaterialCheck(house.id, '组织验收');

    const itemResults: any[] = body.itemResults || [];
    if (plan.items.filter((i) => i.required).length !== itemResults.length) {
      throw new BadRequestException('必须对方案中的每一个必改项逐条给出验收结论');
    }
    // 必改项须先完成施工
    for (const it of plan.items.filter((i) => i.required)) {
      if (it.status !== ItemStatus.DONE) {
        throw new BadRequestException(`整改项「${itemTypeLabel(it.type)}」施工状态为${itemStatusLabel(it.status)}，未完成不能验收`);
      }
      const r = itemResults.find((x) => x.itemId === it.id);
      if (!r) throw new BadRequestException(`缺少整改项「${itemTypeLabel(it.type)}」的验收结论`);
    }
    const anyFail = itemResults.some((r) => r.result === AcceptanceResult.FAIL);
    const overall = anyFail ? AcceptanceResult.FAIL : AcceptanceResult.PASS;

    return this.dataSource.transaction(async (m) => {
      const acc = await m.save(
        m.create(Acceptance, {
          houseId: house.id,
          planId: plan.id,
          inspectorId: u.sub,
          inspectorName: u.name,
          acceptedAt: new Date(),
          overall,
          comment: body.comment || '',
        }),
      );
      for (const r of itemResults) {
        await m.save(
          m.create(AcceptanceItemResult, {
            acceptanceId: acc.id,
            itemId: r.itemId,
            itemType: r.itemType,
            result: r.result,
            note: r.note || '',
            photos: r.photos || [],
          }),
        );
        if (r.result === AcceptanceResult.FAIL) {
          const item = await m.findOne(RectificationItem, { where: { id: r.itemId } });
          if (item) {
            item.status = ItemStatus.FAILED;
            await m.save(item);
          }
        }
      }

      if (overall === AcceptanceResult.FAIL) {
        house.status = HouseStatus.ACCEPTANCE_FAILED;
        await m.save(house);
        await m.save(
          m.create(IssueRecord, {
            houseId: house.id,
            type: IssueType.ACCEPTANCE_FAIL,
            description: `验收不通过：${itemResults.filter((r) => r.result === 'FAIL').map((r) => itemTypeLabel(r.itemType)).join('、')}；${body.comment || ''}`,
            status: IssueStatus.OPEN,
            blocksWorkflow: true,
            raisedById: u.sub,
            raisedByName: u.name,
            raisedAt: new Date(),
          }),
        );
        await m.save(
          m.create(HouseActivity, {
            houseId: house.id,
            kind: 'ACCEPTANCE',
            title: '验收不通过，退回重新整改',
            detail: body.comment || '',
            operatorId: u.sub,
            operatorName: u.name,
          }),
        );
      } else {
        house.status = HouseStatus.PENDING_ACCEPTANCE;
        await m.save(house);
        await m.save(
          m.create(HouseActivity, {
            houseId: house.id,
            kind: 'ACCEPTANCE',
            title: '验收通过（逐项确认合格），提请县级销号',
            detail: body.comment || '',
            operatorId: u.sub,
            operatorName: u.name,
          }),
        );
      }
      return m.findOne(Acceptance, { where: { id: acc.id }, relations: ['itemResults'] });
    });
  }

  // ---------- 施工材料抽查 ----------
  /** 验收人员发起抽查：施工队提交加固完成照片后，发现钢梁等材料规格与方案不一致 */
  async createMaterialCheck(u: CurrentUser, body: any) {
    const house = await this.getHouseOrFail(body.houseId);
    if (house.status === HouseStatus.CLOSED) throw new BadRequestException('房屋已销号，不能再发起抽查');
    const cplan = await this.cplans.findOne({ where: { houseId: house.id } });
    if (!cplan?.teamId) throw new BadRequestException('尚未确定承接施工队，无法发起材料抽查');
    if (!body.suspectItem) throw new BadRequestException('请填写抽查材料/部位（如：钢梁）');
    const open = await this.openMaterialChecks(house.id);
    if (open.length) throw new BadRequestException('该房屋已有未结案的材料抽查，请先处理');

    const check = await this.materialChecks.save(
      this.materialChecks.create({
        houseId: house.id,
        teamId: cplan.teamId,
        teamName: cplan.teamName,
        raisedById: u.sub,
        raisedByName: u.name,
        raisedAt: new Date(),
        status: MaterialCheckStatus.OPEN,
        suspectItem: body.suspectItem,
        planSpec: body.planSpec || '',
        foundSpec: body.foundSpec || '',
        suspectNote: body.suspectNote || '',
        completionPhotos: body.completionPhotos || [],
      }),
    );
    await this.logActivity(
      house.id,
      'MATERIAL_CHECK',
      `发起施工材料抽查：${body.suspectItem}${body.planSpec || body.foundSpec ? `（方案 ${body.planSpec || '—'} / 现场 ${body.foundSpec || '—'}）` : ''}`,
      `验收人员 ${u.name} 发现材料规格与方案不一致，要求施工队上传材料发票、进场照片和现场测量结果。${body.suspectNote || ''}`,
      u,
    );
    return check;
  }

  /** 施工队提交举证三要素：材料发票、进场照片、现场测量结果 */
  async submitMaterialEvidence(u: CurrentUser, id: string, body: any) {
    const check = await this.materialChecks.findOne({ where: { id } });
    if (!check) throw new NotFoundException('抽查记录不存在');
    if (check.status !== MaterialCheckStatus.OPEN) throw new BadRequestException('仅待举证的抽查可提交举证材料');
    if (u.role === 'TEAM' && u.teamId && check.teamId !== u.teamId) {
      throw new ForbiddenException('该抽查针对的不是本施工队');
    }
    const invoiceDocs = body.invoiceDocs || [];
    const siteEntryPhotos = body.siteEntryPhotos || [];
    if (!invoiceDocs.length) throw new BadRequestException('必须上传材料发票');
    if (!siteEntryPhotos.length) throw new BadRequestException('必须上传材料进场照片');
    if (!body.measurementResult) throw new BadRequestException('必须填写现场测量结果（实测规格/尺寸数据）');

    Object.assign(check, {
      invoiceDocs,
      siteEntryPhotos,
      measurementResult: body.measurementResult,
      measurementPhotos: body.measurementPhotos || [],
      evidenceAt: new Date(),
      evidenceById: u.sub,
      status: MaterialCheckStatus.EVIDENCE_SUBMITTED,
    });
    await this.materialChecks.save(check);
    await this.logActivity(
      check.houseId,
      'MATERIAL_CHECK',
      '施工队已提交抽查举证（发票/进场照片/现场测量结果）',
      `现场测量结果：${body.measurementResult}，等待验收人员对照方案判定。`,
      u,
    );
    return check;
  }

  /** 验收人员对照方案判定：偷换属实 / 澄清合格 */
  async verdictMaterialCheck(u: CurrentUser, id: string, body: any) {
    const check = await this.materialChecks.findOne({ where: { id } });
    if (!check) throw new NotFoundException('抽查记录不存在');
    if (check.status !== MaterialCheckStatus.EVIDENCE_SUBMITTED) throw new BadRequestException('仅已举证待判定的抽查可判定');
    const verdict: MaterialCheckVerdict = body.verdict;
    if (![MaterialCheckVerdict.SWAP, MaterialCheckVerdict.MATCH].includes(verdict)) {
      throw new BadRequestException('判定结果必须为 SWAP（偷换属实）或 MATCH（比对一致）');
    }
    const house = await this.getHouseOrFail(check.houseId);

    return this.dataSource.transaction(async (m) => {
      check.verdict = verdict;
      check.verdictNote = body.note || '';
      check.verdictAt = new Date();
      check.verdictById = u.sub;

      if (verdict === MaterialCheckVerdict.MATCH) {
        check.status = MaterialCheckStatus.CLEARED;
        await m.save(check);
        await m.save(
          m.create(HouseActivity, {
            houseId: house.id, kind: 'MATERIAL_CHECK',
            title: `材料抽查澄清合格：${check.suspectItem} 与方案一致`,
            detail: body.note || '发票、进场照片、现场测量结果与方案规格一致，可继续组织验收',
            operatorId: u.sub, operatorName: u.name,
          }),
        );
        return check;
      }

      // 偷换属实
      check.status = MaterialCheckStatus.CONFIRMED_SWAP;
      await m.save(check);

      // 1) 施工队进入限制接单名单
      const team = await m.findOne(ConstructionTeam, { where: { id: check.teamId } });
      if (team) {
        team.restricted = true;
        team.restrictReason = `材料抽查判定偷换属实：${house.code} ${check.suspectItem}（方案 ${check.planSpec || '—'} / 现场 ${check.foundSpec || '—'}）`;
        team.restrictedAt = new Date();
        await m.save(team);
      }

      // 2) 整改任务回到返工状态：相关必改项退回施工中
      const plan = await m.findOne(ReviewPlan, { where: { houseId: house.id }, order: { reviewedAt: 'DESC' }, relations: ['items'] });
      const resetTypes: string[] = body.resetItemTypes || [];
      const resetItems = plan?.items.filter((it) => it.required && (resetTypes.length ? resetTypes.includes(it.type) : true)) || [];
      for (const it of resetItems) {
        it.status = ItemStatus.IN_PROGRESS;
        await m.save(it);
      }
      house.status = HouseStatus.REWORK;
      await m.save(house);

      // 3) 农户补助拨付暂停（已批准的挂起；待审批的审批/发放闸口另行拦截）
      const sub = await m.findOne(SubsidyApplication, { where: { houseId: house.id } });
      if (sub && sub.status === SubsidyStatus.APPROVED) {
        sub.status = SubsidyStatus.SUSPENDED;
        sub.reviewComment = `材料抽查判定偷换属实（${check.suspectItem}），补助拨付暂停，待返工复验通过后恢复`;
        await m.save(sub);
      }

      // 4) 生成阻断性异常，返工复验通过前冻结验收/销号
      await m.save(
        m.create(IssueRecord, {
          houseId: house.id,
          type: IssueType.MATERIAL_SWAP,
          description: `材料抽查判定偷换属实：${check.suspectItem} 方案要求「${check.planSpec || '—'}」实测「${check.foundSpec || '—'}」；${body.note || ''}`,
          status: IssueStatus.OPEN,
          blocksWorkflow: true,
          raisedById: u.sub,
          raisedByName: u.name,
          raisedAt: new Date(),
        }),
      );
      await m.save(
        m.create(HouseActivity, {
          houseId: house.id, kind: 'MATERIAL_CHECK',
          title: `材料抽查判定偷换属实：${check.suspectItem}——施工队限制接单、补助暂停、退回返工`,
          detail: `退回 ${resetItems.length} 个必改项返工；须由平台重新安排验收节点与补助拨付计划，返工后对照原方案逐项复验。${body.note || ''}`,
          operatorId: u.sub, operatorName: u.name,
        }),
      );
      return check;
    });
  }

  /** 返工期间重新安排验收节点与补助拨付计划 */
  async scheduleRework(u: CurrentUser, id: string, body: any) {
    const check = await this.materialChecks.findOne({ where: { id } });
    if (!check) throw new NotFoundException('抽查记录不存在');
    if (check.status !== MaterialCheckStatus.CONFIRMED_SWAP) throw new BadRequestException('仅偷换属实、退回返工的抽查可重排节点');
    if (!body.reworkDeadline || !body.newAcceptanceDate) throw new BadRequestException('必须填写返工期限和重新安排的验收节点');
    check.reworkDeadline = body.reworkDeadline;
    check.newAcceptanceDate = body.newAcceptanceDate;
    check.newPayPlanDate = body.newPayPlanDate || null;
    check.scheduledAt = new Date();
    await this.materialChecks.save(check);
    await this.logActivity(
      check.houseId, 'MATERIAL_CHECK',
      '已重新安排返工验收节点与补助拨付计划',
      `返工期限 ${body.reworkDeadline}；重新验收 ${body.newAcceptanceDate}；补助计划拨付 ${body.newPayPlanDate || '复验销号后另行安排'}`,
      u,
    );
    return check;
  }

  /** 施工队返工完成后重新提交整改（不能只传一张完工照片） */
  async submitRework(u: CurrentUser, id: string, body: any) {
    const check = await this.materialChecks.findOne({ where: { id } });
    if (!check) throw new NotFoundException('抽查记录不存在');
    if (check.status !== MaterialCheckStatus.CONFIRMED_SWAP) throw new BadRequestException('仅退回返工的抽查可提交返工整改');
    if (u.role === 'TEAM' && u.teamId && check.teamId !== u.teamId) {
      throw new ForbiddenException('该返工任务不属于本施工队');
    }
    if (!check.newAcceptanceDate) throw new BadRequestException('平台尚未重新安排验收节点，请等待乡镇/平台重排后再提交返工');
    if (!body.reworkSummary) throw new BadRequestException('必须填写返工情况说明（如何更换为方案要求材料）');
    if (!(body.reworkPhotos || []).length) throw new BadRequestException('必须上传返工后现场照片');
    if (!(body.reworkMeasurement || []).length) throw new BadRequestException('必须提供返工后实测结果/材料合格证明');

    Object.assign(check, {
      reworkSummary: body.reworkSummary,
      reworkPhotos: body.reworkPhotos || [],
      reworkMeasurement: body.reworkMeasurement || [],
      reworkSubmittedAt: new Date(),
    });
    await this.materialChecks.save(check);
    await this.logActivity(
      check.houseId, 'MATERIAL_CHECK',
      `施工队提交返工整改（${check.suspectItem}），申请对照原方案逐项复验`,
      body.reworkSummary, u,
    );
    return check;
  }

  /** 验收人员对照原方案逐项确认返工结果；任一项不合格不得关闭抽查 */
  async reviewRework(u: CurrentUser, id: string, body: any) {
    const check = await this.materialChecks.findOne({ where: { id } });
    if (!check) throw new NotFoundException('抽查记录不存在');
    if (check.status !== MaterialCheckStatus.CONFIRMED_SWAP) throw new BadRequestException('仅退回返工的抽查可复验');
    if (!check.reworkSubmittedAt) throw new BadRequestException('施工队尚未提交返工整改');
    const house = await this.getHouseOrFail(check.houseId);
    const plan = await this.latestPlan(house.id);
    const required = plan?.items.filter((i) => i.required) || [];
    const itemResults: any[] = body.itemResults || [];

    if (itemResults.length !== required.length) {
      throw new BadRequestException(`必须对照原方案逐项确认全部 ${required.length} 个必改项，不能只凭一张完工照片关闭任务`);
    }
    for (const it of required) {
      const r = itemResults.find((x) => x.itemId === it.id);
      if (!r) throw new BadRequestException(`缺少整改项「${itemTypeLabel(it.type)}」的复验结论`);
    }
    const failed = itemResults.filter((r) => r.result === AcceptanceResult.FAIL);
    if (failed.length) {
      await this.logActivity(
        house.id, 'MATERIAL_CHECK',
        `返工复验仍有 ${failed.length} 项不合格，继续返工`,
        failed.map((r) => `${itemTypeLabel(r.itemType)}：${r.note || '不合格'}`).join('；'), u,
      );
      throw new BadRequestException(`仍有 ${failed.length} 项复验不合格，不能结案：${failed.map((r) => itemTypeLabel(r.itemType)).join('、')}`);
    }

    return this.dataSource.transaction(async (m) => {
      // 逐项复验通过 → 生成重新验收记录（重排的验收节点落地）
      const acc = await m.save(
        m.create(Acceptance, {
          houseId: house.id, planId: plan.id, inspectorId: u.sub, inspectorName: u.name,
          acceptedAt: new Date(), overall: AcceptanceResult.PASS,
          comment: `材料抽查（${check.suspectItem}）返工后对照原方案逐项复验通过。${body.comment || ''}`,
        }),
      );
      for (const r of itemResults) {
        await m.save(
          m.create(AcceptanceItemResult, {
            acceptanceId: acc.id, itemId: r.itemId, itemType: r.itemType,
            result: AcceptanceResult.PASS, note: r.note || '返工复验合格', photos: r.photos || [],
          }),
        );
        const item = await m.findOne(RectificationItem, { where: { id: r.itemId } });
        if (item) { item.status = ItemStatus.DONE; await m.save(item); }
      }

      check.status = MaterialCheckStatus.REWORKED;
      await m.save(check);

      // 阻断异常办结
      const openSwaps = await m.find(IssueRecord, {
        where: { houseId: house.id, type: IssueType.MATERIAL_SWAP, blocksWorkflow: true, status: In([IssueStatus.OPEN, IssueStatus.RESOLVING]) },
      });
      for (const is of openSwaps) {
        is.status = IssueStatus.RESOLVED;
        is.resolution = `更换为方案要求材料并返工，对照原方案逐项复验通过（验收人：${u.name}）`;
        is.resolvedAt = new Date();
        await m.save(is);
      }

      // 恢复暂停的补助到“已批准”，按重排的拨付计划在销号后发放
      const sub = await m.findOne(SubsidyApplication, { where: { houseId: house.id } });
      if (sub && sub.status === SubsidyStatus.SUSPENDED) {
        sub.status = SubsidyStatus.APPROVED;
        sub.reviewComment = '返工复验通过，补助拨付恢复，按重排计划销号后发放';
        await m.save(sub);
      }

      house.status = HouseStatus.PENDING_ACCEPTANCE;
      await m.save(house);
      await m.save(
        m.create(HouseActivity, {
          houseId: house.id, kind: 'MATERIAL_CHECK',
          title: `材料抽查返工结案：${check.suspectItem} 逐项复验合格，补助恢复、提请销号`,
          detail: `施工队仍处于限制接单名单，须由县级主管部门核验后解除；补助拨付计划：${check.newPayPlanDate || '销号后安排'}`,
          operatorId: u.sub, operatorName: u.name,
        }),
      );
      return m.findOne(Acceptance, { where: { id: acc.id }, relations: ['itemResults'] });
    });
  }

  /** 县级解除施工队限制接单 */
  async liftTeamRestriction(u: CurrentUser, teamId: string, body: any) {
    const team = await this.teams.findOne({ where: { id: teamId } });
    if (!team) throw new NotFoundException('施工队不存在');
    if (!team.restricted) return team;
    team.restricted = false;
    team.restrictLiftedAt = new Date();
    if (body?.note) team.restrictReason = `${team.restrictReason || ''}（已解除：${body.note}）`;
    await this.teams.save(team);
    return team;
  }

  // ---------- 销号 ----------
  async closeHouse(u: CurrentUser, body: any) {
    const house = await this.getHouseOrFail(body.houseId);
    const acc = await this.acceptances.findOne({ where: { houseId: house.id }, order: { acceptedAt: 'DESC' }, relations: ['itemResults'] });
    if (!acc || acc.overall !== AcceptanceResult.PASS) throw new BadRequestException('最新验收未通过，不能销号');
    if (house.status !== HouseStatus.PENDING_ACCEPTANCE) {
      throw new BadRequestException('仅“验收通过待销号”状态的房屋可销号');
    }
    if (!body.confirmedAllItems) throw new BadRequestException('须逐项确认整改方案全部完成');
    if (!body.confirmedStopUseLifted) throw new BadRequestException('须确认房屋安全恢复、停用/警示措施按方案处理');
    await this.assertNoBlocking(house.id, '销号');

    return this.dataSource.transaction(async (m) => {
      await m.save(
        m.create(CloseRecord, {
          houseId: house.id,
          acceptanceId: acc.id,
          closedAt: new Date(),
          closedById: u.sub,
          confirmedAllItems: true,
          confirmedStopUseLifted: true,
          remark: body.remark || '',
        }),
      );
      house.status = HouseStatus.CLOSED;
      house.stopUseConfirmed = false;
      await m.save(house);
      // 准许转移人员返回
      await m.update(EvacuationRecord, { houseId: house.id, allowReturn: false }, { allowReturn: true, returnedAt: new Date() });
      await m.save(
        m.create(HouseActivity, {
          houseId: house.id,
          kind: 'CLOSE',
          title: '县级销号：整改按方案完成，房屋恢复安全使用',
          detail: body.remark || '',
          operatorId: u.sub,
          operatorName: u.name,
        }),
      );
      return { ok: true };
    });
  }

  // ---------- 复查 ----------
  async createRecheck(u: CurrentUser, body: any) {
    const house = await this.getHouseOrFail(body.houseId);
    if (house.status !== HouseStatus.CLOSED) throw new BadRequestException('仅已销号房屋需要复查');
    const result: AcceptanceResult = body.result;
    return this.dataSource.transaction(async (m) => {
      await m.save(
        m.create(RecheckRecord, {
          houseId: house.id,
          result,
          reboundNotes: body.reboundNotes || '',
          wallCrack: body.wallCrack ?? null,
          roofLeak: body.roofLeak ?? null,
          foundationSettlement: body.foundationSettlement ?? null,
          checkedAt: new Date(),
          inspectorId: u.sub,
        }),
      );
      if (result === AcceptanceResult.FAIL) {
        house.status = HouseStatus.REBOUND;
        // 回写最新隐患
        if (body.wallCrack != null) house.wallCrack = Number(body.wallCrack);
        if (body.roofLeak != null) house.roofLeak = Number(body.roofLeak);
        if (body.foundationSettlement != null) house.foundationSettlement = Number(body.foundationSettlement);
        await m.save(house);
        await m.save(
          m.create(IssueRecord, {
            houseId: house.id,
            type: IssueType.REBOUND,
            description: `销号后复查发现问题反弹：${body.reboundNotes || '隐患重新出现'}`,
            status: IssueStatus.OPEN,
            blocksWorkflow: true,
            raisedById: u.sub,
            raisedByName: u.name,
            raisedAt: new Date(),
          }),
        );
      }
      await m.save(
        m.create(HouseActivity, {
          houseId: house.id,
          kind: 'RECHECK',
          title: result === AcceptanceResult.PASS ? '复查通过，保持销号' : '复查发现问题反弹，重新纳入治理',
          detail: body.reboundNotes || '',
          operatorId: u.sub,
          operatorName: u.name,
        }),
      );
      return { ok: true };
    });
  }

  // ---------- 房屋档案聚合 ----------
  async listHouses(query: any, u: CurrentUser) {
    const qb = this.houses.createQueryBuilder('h');
    const township = query.township || (u.role === 'TOWNSHIP_REVIEWER' || u.role === 'GRID_WORKER' ? u.township : undefined);
    if (township) qb.andWhere('h.township = :t', { t: township });
    if (query.riskLevel) qb.andWhere('h.riskLevel = :r', { r: query.riskLevel });
    if (query.status) qb.andWhere('h.status = :s', { s: query.status });
    if (query.q) qb.andWhere('(h.ownerName ILIKE :q OR h.address ILIKE :q OR h.code ILIKE :q OR h.village ILIKE :q)', { q: `%${query.q}%` });
    qb.orderBy('h.createdAt', 'DESC');
    const [data, total] = await qb.take(Math.min(Number(query.limit) || 100, 500)).skip(Number(query.offset) || 0).getManyAndCount();
    return { total, data };
  }

  async houseArchive(id: string) {
    const house = await this.getHouseOrFail(id);
    const [
      inspections, plans, notices, evacuations, stakeholders, consultations, issues,
      family, cplan, subsidy, logs, acceptances, close, rechecks, activities, materialChecks,
    ] = await Promise.all([
      this.inspections.find({ where: { houseId: id }, order: { inspectedAt: 'DESC' } }),
      this.plans.find({ where: { houseId: id }, order: { reviewedAt: 'DESC' }, relations: ['items'] }),
      this.notices.find({ where: { houseId: id }, order: { notifiedAt: 'DESC' } }),
      this.evacuations.find({ where: { houseId: id }, order: { settledAt: 'DESC' } }),
      this.stakeholders.find({ where: { houseId: id } }),
      this.consultations.find({ where: { houseId: id }, order: { heldAt: 'DESC' } }),
      this.issues.find({ where: { houseId: id }, order: { raisedAt: 'DESC' } }),
      this.families.findOne({ where: { houseId: id } }),
      this.cplans.findOne({ where: { houseId: id }, relations: ['budgetItems'] }),
      this.subsidies.findOne({ where: { houseId: id } }),
      this.logs.find({ where: { houseId: id }, order: { recordedAt: 'DESC' } }),
      this.acceptances.find({ where: { houseId: id }, order: { acceptedAt: 'DESC' }, relations: ['itemResults'] }),
      this.closes.findOne({ where: { houseId: id } }),
      this.rechecks.find({ where: { houseId: id }, order: { checkedAt: 'DESC' } }),
      this.activities.find({ where: { houseId: id }, order: { createdAt: 'DESC' }, take: 200 }),
      this.materialChecks.find({ where: { houseId: id }, order: { raisedAt: 'DESC' } }),
    ]);
    const blockingIssues = issues.filter((i) => i.blocksWorkflow && i.status !== IssueStatus.RESOLVED);
    return {
      house, inspections, plans, notices, evacuations, stakeholders, consultations, issues, blockingIssues,
      family, constructionPlan: cplan, subsidy, constructionLogs: logs, acceptances, close, rechecks, activities,
      materialChecks,
    };
  }

  // ---------- 县级驾驶舱 ----------
  async dashboard(query: any, u?: CurrentUser) {
    const forcedTownship = u && (u.role === 'TOWNSHIP_REVIEWER' || u.role === 'GRID_WORKER') ? u.township : null;
    const township = query.township || forcedTownship || null;
    const filter = township ? { township } : {};
    const houses = await this.houses.find({ where: filter });
    const byRisk: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byTownship: Record<string, { total: number; highRisk: number; closed: number; rebound: number }> = {};
    let closed = 0, rebound = 0, highRisk = 0, highRiskStopped = 0;
    for (const h of houses) {
      byRisk[h.riskLevel] = (byRisk[h.riskLevel] || 0) + 1;
      byStatus[h.status] = (byStatus[h.status] || 0) + 1;
      const t = byTownship[h.township] || { total: 0, highRisk: 0, closed: 0, rebound: 0 };
      t.total++;
      const isHigh = h.riskLevel === RiskLevel.SUSPEND || h.riskLevel === RiskLevel.EVACUATE;
      if (isHigh) {
        highRisk++;
        t.highRisk++;
        if ([HouseStatus.STOPPED, HouseStatus.EVACUATED, HouseStatus.RECTIFYING, HouseStatus.REWORK, HouseStatus.PENDING_ACCEPTANCE, HouseStatus.CLOSED, HouseStatus.ACCEPTANCE_FAILED].includes(h.status)) {
          highRiskStopped++;
        }
      }
      if (h.status === HouseStatus.CLOSED) {
        closed++;
        t.closed++;
      }
      if (h.status === HouseStatus.REBOUND) {
        rebound++;
        t.rebound++;
      }
      byTownship[h.township] = t;
    }

    // 高风险但未真正停用的房屋（县级最关注）
    const qbStopped = this.houses
      .createQueryBuilder('h')
      .where('h.riskLevel IN (:...rs)', { rs: [RiskLevel.SUSPEND, RiskLevel.EVACUATE] })
      .andWhere('h.status NOT IN (:...ss)', {
        ss: [HouseStatus.STOPPED, HouseStatus.EVACUATED, HouseStatus.RECTIFYING, HouseStatus.REWORK, HouseStatus.PENDING_ACCEPTANCE, HouseStatus.CLOSED, HouseStatus.ACCEPTANCE_FAILED],
      });
    if (township) qbStopped.andWhere('h.township = :t', { t: township });
    const notStopped = await qbStopped.getMany();

    // 异常分类
    const issueQb = this.issues.createQueryBuilder('i').leftJoin(House, 'h', 'h.id::text = i."houseId"::text');
    if (township) issueQb.andWhere('h.township = :t', { t: township });
    const allIssues = await issueQb.getMany();
    const issuesByType: Record<string, { open: number; resolved: number }> = {};
    for (const i of allIssues) {
      const k = i.type;
      issuesByType[k] = issuesByType[k] || { open: 0, resolved: 0 };
      if (i.status === IssueStatus.RESOLVED) issuesByType[k].resolved++;
      else issuesByType[k].open++;
    }

    // 补助
    const subQb = this.subsidies.createQueryBuilder('s').leftJoin(House, 'h', 'h.id::text = s."houseId"::text');
    if (township) subQb.andWhere('h.township = :t', { t: township });
    const subsidies = await subQb.getMany();
    const subsidySummary = { draft: 0, submitted: 0, approved: 0, suspended: 0, rejected: 0, paid: 0, paidAmount: 0 };
    for (const s of subsidies) {
      if (s.status === SubsidyStatus.DRAFT) subsidySummary.draft++;
      if (s.status === SubsidyStatus.SUBMITTED) subsidySummary.submitted++;
      if (s.status === SubsidyStatus.APPROVED) subsidySummary.approved++;
      if (s.status === SubsidyStatus.SUSPENDED) subsidySummary.suspended++;
      if (s.status === SubsidyStatus.REJECTED) subsidySummary.rejected++;
      if (s.status === SubsidyStatus.PAID) {
        subsidySummary.paid++;
        subsidySummary.paidAmount += Number(s.amount);
      }
    }

    // 材料抽查 / 限制接单施工队
    const allChecks = await this.materialChecks.find();
    const materialCheckSummary = { total: 0, open: 0, evidence: 0, confirmed: 0, cleared: 0, reworked: 0 };
    for (const c of allChecks) {
      materialCheckSummary.total++;
      if (c.status === MaterialCheckStatus.OPEN) materialCheckSummary.open++;
      if (c.status === MaterialCheckStatus.EVIDENCE_SUBMITTED) materialCheckSummary.evidence++;
      if (c.status === MaterialCheckStatus.CONFIRMED_SWAP) materialCheckSummary.confirmed++;
      if (c.status === MaterialCheckStatus.CLEARED) materialCheckSummary.cleared++;
      if (c.status === MaterialCheckStatus.REWORKED) materialCheckSummary.reworked++;
    }
    const restrictedTeams = (await this.teams.find({ where: { restricted: true } })).map((t) => ({
      id: t.id, name: t.name, qualificationNo: t.qualificationNo, restrictReason: t.restrictReason, restrictedAt: t.restrictedAt,
    }));

    // 整改项完成情况
    const planQb = this.items.createQueryBuilder('it').leftJoin(ReviewPlan, 'p', 'p.id::text = it."planId"::text').leftJoin(House, 'h', 'h.id::text = p."houseId"::text');
    if (township) planQb.andWhere('h.township = :t', { t: township });
    const allItems = await planQb.getMany();
    const itemByType: Record<string, { total: number; done: number; failed: number }> = {};
    for (const it of allItems) {
      const k = itemByType[it.type] || { total: 0, done: 0, failed: 0 };
      k.total++;
      if (it.status === ItemStatus.DONE) k.done++;
      if (it.status === ItemStatus.FAILED) k.failed++;
      itemByType[it.type] = k;
    }

    return {
      totalHouses: houses.length,
      byRisk,
      byStatus,
      byTownship,
      closed,
      rebound,
      highRisk,
      highRiskStopped,
      highRiskStopRate: highRisk ? Number((highRiskStopped / highRisk).toFixed(2)) : 1,
      notStoppedHouses: notStopped.map((h) => ({ id: h.id, code: h.code, township: h.township, village: h.village, ownerName: h.ownerName, riskLevel: h.riskLevel, status: h.status })),
      issuesByType,
      subsidySummary,
      materialCheckSummary,
      restrictedTeams,
      itemByType,
      closureRate: houses.length ? Number((closed / houses.length).toFixed(2)) : 0,
    };
  }
}

// ---------- 标签 ----------
export function riskLabel(l: RiskLevel) {
  return { NORMAL: '一般关注', RECTIFY: '限期整改', SUSPEND: '暂停使用', EVACUATE: '紧急转移' }[l] || l;
}
export function houseStatusLabel(s: HouseStatus) {
  return {
    PENDING_REVIEW: '待复核', IN_PLAN: '已出方案', NOTIFIED: '已告知', STOPPED: '已停用',
    EVACUATED: '已转移', RECTIFYING: '整改中', REWORK: '返工中（材料偷换）', PENDING_ACCEPTANCE: '待销号', ACCEPTANCE_FAILED: '验收不通过',
    CLOSED: '已销号', REBOUND: '问题反弹', REFUSED: '拒绝整改',
  }[s] || s;
}
export function materialCheckStatusLabel(s: string) {
  return {
    OPEN: '待施工队举证',
    EVIDENCE_SUBMITTED: '已举证待判定',
    CONFIRMED_SWAP: '偷换属实·返工中',
    CLEARED: '澄清合格',
    REWORKED: '返工复验通过',
  }[s] || s;
}
export function itemTypeLabel(t: string) {
  return {
    REMOVE_ILLEGAL_FLOOR: '拆除违建加层', REINFORCE_WALL: '加固承重墙', REPAIR_ROOF: '修复屋面',
    EVICT_TENANTS: '清退经营租户', SET_WARNING: '设置警示', TEMP_RESETTLEMENT: '安排临时安置',
  }[t] || t;
}
export function itemStatusLabel(s: string) {
  return { PENDING: '待施工', IN_PROGRESS: '施工中', DONE: '已完成', FAILED: '不合格' }[s] || s;
}
export function issueTypeLabel(t: string) {
  return {
    FARMER_REFUSE: '农户拒绝整改', MATERIAL_SWAP: '偷换材料', SUBSIDY_DISPUTE: '补助资格争议',
    RAIN_SEASON: '雨季风险加重', TENANT_REFUSE: '租户不愿搬离', ACCEPTANCE_FAIL: '验收不通过', REBOUND: '问题反弹',
  }[t] || t;
}
export function difficultyLabel(d: string) {
  return {
    NONE: '无', LOW_INCOME: '低保户', FIVE_GUARANTEE: '五保户', DISABLED: '残疾人家庭',
    MONITORING: '防止返贫监测户', VETERAN: '优抚对象',
  }[d] || d;
}
