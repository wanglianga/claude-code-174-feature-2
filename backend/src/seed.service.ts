import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AcceptanceResult,
  ConstructionTeam,
  DifficultyType,
  House,
  ItemStatus,
  IssueStatus,
  IssueType,
  RiskLevel,
  Stakeholder,
  Stance,
  StakeholderType,
  User,
  UserRole,
} from './entities';
import { AppService, CurrentUser } from './app.service';
import { hashPassword } from './auth.controller';

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Seed');
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(ConstructionTeam) private teams: Repository<ConstructionTeam>,
    private svc: AppService,
  ) {}

  async onApplicationBootstrap() {
    if ((await this.users.count()) > 0) {
      this.logger.log('已存在数据，跳过种子');
      return;
    }
    try {
      await this.run();
      this.logger.log('种子数据写入完成');
    } catch (e) {
      this.logger.error(`种子数据写入失败: ${e?.message}`);
    }
  }

  private async mkUser(username: string, name: string, role: UserRole, township?: string, teamId?: string) {
    const u = await this.users.save(
      this.users.create({
        username,
        passwordHash: hashPassword('123456'),
        name,
        role,
        township,
        phone: '13800000000',
        teamId,
      }),
    );
    return this.asUser(u);
  }

  private asUser(u: User): CurrentUser {
    return { sub: u.id, username: u.username, name: u.name, role: u.role, township: u.township, teamId: u.teamId };
  }

  private daysFromNow(n: number) {
    return new Date(Date.now() + n * 86400000);
  }
  private dateStr(n: number) {
    return this.daysFromNow(n).toISOString().slice(0, 10);
  }

  async run() {
    // ---------- 用户 ----------
    const grid1 = await this.mkUser('grid1', '周明（溪口网格员）', UserRole.GRID_WORKER, '溪口镇');
    const grid2 = await this.mkUser('grid2', '吴芳（云岭网格员）', UserRole.GRID_WORKER, '云岭乡');
    const grid3 = await this.mkUser('grid3', '孙立（青山网格员）', UserRole.GRID_WORKER, '青山镇');
    const town1 = await this.mkUser('town1', '陈建设（溪口住建）', UserRole.TOWNSHIP_REVIEWER, '溪口镇');
    const town2 = await this.mkUser('town2', '刘志强（云岭住建）', UserRole.TOWNSHIP_REVIEWER, '云岭乡');
    const town3 = await this.mkUser('town3', '马海涛（青山住建）', UserRole.TOWNSHIP_REVIEWER, '青山镇');
    const county = await this.mkUser('county1', '王建国（县住建局）', UserRole.COUNTY_ADMIN);
    const acceptor = await this.mkUser('acceptor1', '赵严谨（县级验收员）', UserRole.ACCEPTOR);
    const farmer1 = await this.mkUser('farmer1', '王德福', UserRole.FARMER, '溪口镇');
    const farmer2 = await this.mkUser('farmer2', '李秀兰', UserRole.FARMER, '云岭乡');
    const farmer3 = await this.mkUser('farmer3', '张大山', UserRole.FARMER, '青山镇');

    const teamA = await this.teams.save(
      this.teams.create({
        name: '安泰农房加固施工队',
        qualificationNo: 'XKJZ-2024-018',
        qualificationDoc: ['/uploads/demo-qual-a.jpg'],
        qualified: true,
        contact: '钱工',
        phone: '13900001111',
        scope: '承重墙加固、屋面修复、加层拆除',
      }),
    );
    const teamB = await this.teams.save(
      this.teams.create({
        name: '顺达民间施工队',
        qualificationNo: 'XKJZ-2019-007（已过期）',
        qualificationDoc: [],
        qualified: false,
        contact: '孙队长',
        phone: '13900002222',
        scope: '一般土建（资质过期，不得承接加固）',
      }),
    );
    const teamUser = await this.mkUser('team1', '钱工（安泰施工队）', UserRole.TEAM, undefined, teamA.id);

    // ---------- 房屋A：全流程已销号，补助已发，复查通过 ----------
    {
      const insp = await this.svc.createInspection(grid1, {
        code: 'NF-XK-000001',
        township: '溪口镇', village: '溪口村', address: '溪口村三组18号',
        ownerName: '王德福', ownerPhone: '13811110001', lng: 118.12, lat: 29.34,
        buildYear: 1998, floors: 3, usage: '自住+出租', isRented: true, isAddedFloor: true,
        wallCrack: 2, roofLeak: 1, foundationSettlement: 1, residents: 5,
        notes: '三层为2021年自行加建，承重墙出现斜向贯通裂缝',
      });
      const houseId = insp.house.id;
      const plan = await this.svc.createReview(town1, {
        inspectionId: insp.inspection.id,
        decision: RiskLevel.EVACUATE,
        requirement: '立即停止使用三层，拆除违建加层，加固二层承重墙，人员临时转移，设置围挡警示。',
        deadline: this.dateStr(30),
        items: [
          { type: 'REMOVE_ILLEGAL_FLOOR', description: '拆除三层违建加层约90㎡' },
          { type: 'REINFORCE_WALL', description: '对二层4道承重墙采用钢筋网抹面加固' },
          { type: 'TEMP_RESETTLEMENT', description: '5名居住人员临时安置至村部安置点' },
          { type: 'SET_WARNING', description: '房屋周围设置围挡和危房警示标志' },
        ],
      });
      await this.svc.createNotice(grid1, {
        houseId, method: '书面送达', notifiedTo: ['户主王德福', '二层租户刘姓一家'], acknowledged: true,
        content: '房屋评定为紧急转移等级，限30日内完成整改，逾期依法停用',
      });
      await this.svc.createEvacuation(grid1, {
        houseId, residents: 5, destination: '溪口村部安置点',
        remark: '2户投亲，3人居村部安置点，发放生活物资',
      });
      await this.svc.upsertFamily(houseId, {
        difficultyType: DifficultyType.LOW_INCOME,
        difficultyProof: ['/uploads/demo-dibao.jpg'],
        ownershipType: '自有（宅基地）',
        ownershipProof: ['/uploads/demo-quanshu.jpg'],
        ownerConsent: true,
        membersNote: '户内2名老人，户主腰部残疾，部分丧失劳动能力',
      });
      await this.svc.upsertStakeholder(houseId, {
        type: StakeholderType.TENANT, name: '租户刘军', phone: '13700000001',
        stance: Stance.SUPPORT, influenceNote: '初期担心押金不退，经协商户主退还押金后配合搬离',
      });
      await this.svc.createConsultation(town1, {
        houseId, topic: '加层拆除与租户搬离协商',
        attendeeIds: [], outcome: '户主同意拆除加层；村委见证押金退还；施工期间老人由子女接走照料。',
      });
      const cplan = await this.svc.submitConstructionPlan(farmer1, {
        houseId, teamId: teamA.id, startDate: this.dateStr(2), endDate: this.dateStr(25),
        description: '按复核方案施工，先拆除后加固',
        budgetItems: [
          { name: '加层拆除及渣土清运', spec: '', qty: 90, unit: '㎡', unitPrice: 120 },
          { name: '钢筋', spec: 'HRB400 12mm', qty: 2.5, unit: '吨', unitPrice: 4600 },
          { name: '商品混凝土', spec: 'C30', qty: 18, unit: 'm³', unitPrice: 480 },
          { name: '临时安置补助', spec: '', qty: 30, unit: '人天', unitPrice: 50 },
          { name: '围挡警示', spec: '', qty: 1, unit: '项', unitPrice: 1800 },
        ],
      });
      const sub = await this.svc.submitSubsidy(farmer1, houseId, { amount: 30000 });
      await this.svc.reviewSubsidy(town1, sub.application.id, { approved: true, comment: '低保户，材料齐全，同意按核定预算70%补助' });

      // 施工过程（材料与预算一致）
      await this.svc.addConstructionLog(teamUser, {
        houseId, stage: '拆除加层', content: '三层违建加层拆除完毕，渣土清运完成', progressPercent: 30,
        itemId: plan.items.find((i) => i.type === 'REMOVE_ILLEGAL_FLOOR').id, itemStatus: ItemStatus.DONE,
      });
      await this.svc.addConstructionLog(teamUser, {
        houseId, stage: '墙体加固', content: '进场钢筋与混凝土，规格与预算一致，监理现场核验',
        materialName: '钢筋', materialSpec: 'HRB400 12mm', progressPercent: 55,
        itemId: plan.items.find((i) => i.type === 'REINFORCE_WALL').id, itemStatus: ItemStatus.IN_PROGRESS,
      });
      await this.svc.addConstructionLog(teamUser, {
        houseId, stage: '墙体加固', content: '4道承重墙钢筋网抹面加固完成，养护到位',
        materialName: '商品混凝土', materialSpec: 'C30', progressPercent: 90,
        itemId: plan.items.find((i) => i.type === 'REINFORCE_WALL').id, itemStatus: ItemStatus.DONE,
      });
      await this.svc.setItemStatus(town1, plan.items.find((i) => i.type === 'TEMP_RESETTLEMENT').id, ItemStatus.DONE);
      await this.svc.setItemStatus(town1, plan.items.find((i) => i.type === 'SET_WARNING').id, ItemStatus.DONE);

      await this.svc.createAcceptance(acceptor, {
        houseId,
        comment: '逐项核验：加层已拆除、承重墙加固合格、安置到位、警示规范',
        itemResults: plan.items.map((it) => ({ itemId: it.id, itemType: it.type, result: AcceptanceResult.PASS, note: '现场核验合格' })),
      });
      await this.svc.closeHouse(county, {
        houseId, confirmedAllItems: true, confirmedStopUseLifted: true,
        remark: '材料核验记录完整，人员已安全返回，同意销号',
      });
      await this.svc.createRecheck(grid1, { houseId, result: AcceptanceResult.PASS });
      // 销号后发放补助
      const paid = await this.svc.getSubsidyByHouse(houseId);
      await this.svc.paySubsidy(county, paid.id);
    }

    // ---------- 房屋B：完工照片后钢梁抽查，规格与方案不一致，待施工队举证 ----------
    {
      const insp = await this.svc.createInspection(grid2, {
        code: 'NF-YL-000002',
        township: '云岭乡', village: '大岭村', address: '大岭村老学校旁',
        ownerName: '李秀兰', ownerPhone: '13811110002',
        buildYear: 2005, floors: 2, usage: '小卖部+自住', isBusiness: true,
        wallCrack: 1, roofLeak: 2, foundationSettlement: 0, residents: 3,
        notes: '一层经营副食店，屋面雨天多处渗漏，后墙有明显水平裂缝',
      });
      const houseId = insp.house.id;
      const plan = await this.svc.createReview(town2, {
        inspectionId: insp.inspection.id,
        decision: RiskLevel.SUSPEND,
        requirement: '暂停一层经营，加固后墙（架设钢梁），修复屋面，经验收合格后方可恢复经营。',
        deadline: this.dateStr(20),
        items: [
          { type: 'REINFORCE_WALL', description: '后墙增设构造柱并架设 Q355B 钢梁加固' },
          { type: 'REPAIR_ROOF', description: '屋面重新做防水层并更换破损檩条' },
          { type: 'EVICT_TENANTS', description: '停业期间清退店内堆货经营，劝离留宿人员' },
        ],
      });
      await this.svc.createNotice(grid2, {
        houseId, method: '现场告知', notifiedTo: ['户主李秀兰'], acknowledged: true,
      });
      await this.svc.confirmStopUse(grid2, houseId, { confirmed: true, remark: '店铺门口张贴停业通知，拉警戒线' });
      await this.svc.upsertFamily(houseId, {
        difficultyType: DifficultyType.DISABLED,
        difficultyProof: ['/uploads/demo-canji.jpg'],
        ownershipProof: ['/uploads/demo-quanshu2.jpg'],
        ownerConsent: true,
        membersNote: '户主肢体四级残疾，小店为主要收入来源',
      });
      await this.svc.submitConstructionPlan(farmer2, {
        houseId, teamId: teamA.id, startDate: this.dateStr(1), endDate: this.dateStr(18),
        budgetItems: [
          { name: '防水卷材', spec: 'SBS 4mm', qty: 120, unit: '㎡', unitPrice: 45 },
          { name: '商品混凝土', spec: 'C30', qty: 8, unit: 'm³', unitPrice: 480 },
          { name: '钢筋', spec: 'HRB400 14mm', qty: 1.2, unit: '吨', unitPrice: 4600 },
          { name: '钢梁', spec: 'Q355B HN200×100（腹板≥5.5mm）', qty: 6, unit: '根', unitPrice: 820 },
        ],
      });
      const sub = await this.svc.submitSubsidy(farmer2, houseId, { amount: 12000 });
      await this.svc.reviewSubsidy(town2, sub.application.id, { approved: true, comment: '残疾家庭，同意补助，资金待销号后发放' });

      // 施工过程：台账材料与预算一致，施工队提交加固完成照片，各必改项报完成
      await this.svc.addConstructionLog(teamUser, {
        houseId, stage: '屋面修复', content: '屋面防水卷材铺设完成，淋水试验无渗漏', progressPercent: 50,
        materialName: '防水卷材', materialSpec: 'SBS 4mm', photos: ['/uploads/demo-roof-progress.jpg'],
        itemId: plan.items.find((i) => i.type === 'REPAIR_ROOF').id, itemStatus: ItemStatus.DONE,
      });
      await this.svc.addConstructionLog(teamUser, {
        houseId, stage: '墙体加固', content: '后墙构造柱浇筑完成', progressPercent: 80,
        materialName: '商品混凝土', materialSpec: 'C30',
        itemId: plan.items.find((i) => i.type === 'REINFORCE_WALL').id, itemStatus: ItemStatus.IN_PROGRESS,
      });
      await this.svc.addConstructionLog(teamUser, {
        houseId, stage: '墙体加固', content: '后墙6根钢梁架设完成，施工队提交加固完成照片申请验收', progressPercent: 100,
        materialName: '钢梁', materialSpec: 'Q355B HN200×100（腹板≥5.5mm）', photos: ['/uploads/demo-steel-done.jpg'],
        itemId: plan.items.find((i) => i.type === 'REINFORCE_WALL').id, itemStatus: ItemStatus.DONE,
      });
      await this.svc.setItemStatus(town2, plan.items.find((i) => i.type === 'EVICT_TENANTS').id, ItemStatus.DONE);

      // 验收人员对照完工照片现场抽查：钢梁钢印/实测规格与方案不一致，发起材料抽查
      await this.svc.createMaterialCheck(acceptor, {
        houseId,
        suspectItem: '钢梁',
        planSpec: 'Q355B HN200×100（腹板≥5.5mm）',
        foundSpec: '钢印 Q235，实测 HN198×99、腹板厚 4.5mm',
        suspectNote: '施工队提交加固完成照片后抽查发现钢梁规格与方案不一致，平台要求上传材料发票、进场照片和现场测量结果',
        completionPhotos: ['/uploads/demo-steel-done.jpg'],
      });

      await this.svc.upsertStakeholder(houseId, {
        type: StakeholderType.OPERATOR, name: '李秀兰（经营户）', stance: Stance.NEUTRAL,
        influenceNote: '担心停业损失，希望缩短工期；同意先加固后经营',
      });
    }

    // ---------- 房屋C：户主+租户抵触，尚未告知，协商中 ----------
    {
      const insp = await this.svc.createInspection(grid3, {
        code: 'NF-QS-000003',
        township: '青山镇', village: '和平村', address: '和平村公路边7号',
        ownerName: '张大山', ownerPhone: '13811110003',
        buildYear: 2012, floors: 4, usage: '自住+出租', isRented: true, isBusiness: true, isAddedFloor: true,
        wallCrack: 1, roofLeak: 0, foundationSettlement: 0, residents: 8,
        notes: '临街四层，四层为加建，一楼麻将馆，二三层出租，人员密集',
      });
      const houseId = insp.house.id;
      await this.svc.createReview(town3, {
        inspectionId: insp.inspection.id,
        decision: RiskLevel.SUSPEND,
        requirement: '暂停经营和出租，拆除四层加层，加固墙体后复核使用条件。',
        deadline: this.dateStr(45),
        items: [
          { type: 'REMOVE_ILLEGAL_FLOOR', description: '拆除四层自行加建部分' },
          { type: 'REINFORCE_WALL', description: '三、四层连接处墙体加固' },
          { type: 'EVICT_TENANTS', description: '清退二三层6名租户，关停一楼经营' },
        ],
      });
      await this.svc.raiseIssue(grid3, {
        houseId, type: IssueType.FARMER_REFUSE,
        description: '户主认为加层已使用多年不愿拆除，拒绝在告知书上签字',
      });
      await this.svc.raiseIssue(grid3, {
        houseId, type: IssueType.TENANT_REFUSE,
        description: '3户租户租期未到、不愿搬离，要求户主退租金和押金',
      });
      await this.svc.upsertStakeholder(houseId, {
        type: StakeholderType.OWNER, name: '张大山', stance: Stance.OPPOSE,
        influenceNote: '户主掌握拆除决定权，担心租金损失，是关键协商对象',
      });
      await this.svc.upsertStakeholder(houseId, {
        type: StakeholderType.TENANT, name: '租户陈伟等3户', stance: Stance.OPPOSE,
        influenceNote: '拒绝搬离导致清退项无法启动；要求退还押金并给搬迁宽限',
      });
      await this.svc.upsertStakeholder(houseId, {
        type: StakeholderType.ELDER, name: '张母（82岁）', stance: Stance.OPPOSE,
        influenceNote: '老人反对折腾搬家，影响户主决定，需子女共同做工作',
      });
      await this.svc.upsertStakeholder(houseId, {
        type: StakeholderType.CADRE, name: '村支书何平', stance: Stance.SUPPORT,
        influenceNote: '牵头组织三方协商，承诺协助追回押金、安排临时房源信息',
      });
      await this.svc.createConsultation(town3, {
        houseId, topic: '第一次三方协商（户主/租户/村委）',
        outcome: '户主仍未同意拆除；村委提出押金由村集体账户先行垫付、3户租户7日内搬离；约定3天后再次协商，老人由其女儿接走暂住。',
      });
    }

    // ---------- 房屋D：新巡查待复核（雨季） ----------
    {
      await this.svc.createInspection(grid2, {
        code: 'NF-YL-000004',
        township: '云岭乡', village: '石坎村', address: '石坎村坡脚',
        ownerName: '周树根', ownerPhone: '13811110004',
        buildYear: 1985, floors: 2, usage: '自住',
        wallCrack: 0, roofLeak: 2, foundationSettlement: 0, residents: 2,
        rainSeason: true, notes: '连续强降雨后屋面严重渗漏，屋后边坡有小型溜滑迹象',
      });
    }

    // ---------- 房屋E：验收不通过，退回整改 ----------
    {
      const insp = await this.svc.createInspection(grid1, {
        code: 'NF-XK-000005',
        township: '溪口镇', village: '双溪村', address: '双溪村桥头',
        ownerName: '郑桂花', ownerPhone: '13811110005',
        buildYear: 2002, floors: 3, usage: '服装加工作坊', isBusiness: true, isAddedFloor: true,
        wallCrack: 1, roofLeak: 1, foundationSettlement: 0, residents: 2,
      });
      const houseId = insp.house.id;
      const plan = await this.svc.createReview(town1, {
        inspectionId: insp.inspection.id, decision: RiskLevel.SUSPEND,
        requirement: '拆除三层加建，清退作坊，加固墙体。',
        deadline: this.dateStr(25),
        items: [
          { type: 'REMOVE_ILLEGAL_FLOOR', description: '拆除三层加建' },
          { type: 'EVICT_TENANTS', description: '清退加工作坊设备和工人' },
        ],
      });
      await this.svc.createNotice(grid1, { houseId, method: '书面送达', notifiedTo: ['户主郑桂花', '作坊负责人'], acknowledged: true });
      await this.svc.confirmStopUse(grid1, houseId, { confirmed: true });
      await this.svc.upsertFamily(houseId, {
        difficultyType: DifficultyType.MONITORING,
        difficultyProof: ['/uploads/demo-jianche.jpg'],
        ownershipProof: ['/uploads/demo-quanshu3.jpg'],
        ownerConsent: true,
      });
      await this.svc.submitConstructionPlan(farmer1, {
        houseId, teamId: teamA.id, startDate: this.dateStr(1), endDate: this.dateStr(20),
        budgetItems: [
          { name: '加层拆除及清运', spec: '', qty: 60, unit: '㎡', unitPrice: 120 },
        ],
      });
      await this.svc.addConstructionLog(teamUser, {
        houseId, stage: '拆除加层', content: '三层加建已拆除', progressPercent: 80,
        itemId: plan.items[0].id, itemStatus: ItemStatus.DONE,
      });
      await this.svc.setItemStatus(town1, plan.items[1].id, ItemStatus.DONE);
      await this.svc.createAcceptance(acceptor, {
        houseId, comment: '现场仍有缝纫设备和工人留宿，清退不彻底；拆除断面未封闭',
        itemResults: [
          { itemId: plan.items[0].id, itemType: plan.items[0].type, result: AcceptanceResult.FAIL, note: '拆除后断面未做防护' },
          { itemId: plan.items[1].id, itemType: plan.items[1].type, result: AcceptanceResult.FAIL, note: '仍有工人留宿，经营未清退' },
        ],
      });
    }

    // ---------- 房屋F：已销号后复查反弹 ----------
    {
      const insp = await this.svc.createInspection(grid3, {
        code: 'NF-QS-000006',
        township: '青山镇', village: '柳湾村', address: '柳湾村六组',
        ownerName: '吴明远', ownerPhone: '13811110006',
        buildYear: 1995, floors: 2, usage: '自住',
        wallCrack: 1, roofLeak: 2, foundationSettlement: 0, residents: 2,
      });
      const houseId = insp.house.id;
      const plan = await this.svc.createReview(town3, {
        inspectionId: insp.inspection.id, decision: RiskLevel.RECTIFY,
        requirement: '修复屋面防水，加固开裂墙体。',
        deadline: this.dateStr(20),
        items: [
          { type: 'REPAIR_ROOF', description: '屋面防水重做' },
          { type: 'REINFORCE_WALL', description: '裂缝墙体修复加固' },
        ],
      });
      await this.svc.createNotice(grid3, { houseId, method: '现场告知', notifiedTo: ['户主吴明远'], acknowledged: true });
      await this.svc.upsertFamily(houseId, {
        difficultyType: DifficultyType.FIVE_GUARANTEE,
        difficultyProof: ['/uploads/demo-wubao.jpg'],
        ownershipProof: ['/uploads/demo-quanshu4.jpg'],
        ownerConsent: true,
      });
      await this.svc.submitConstructionPlan(farmer3, {
        houseId, teamId: teamA.id, startDate: this.dateStr(1), endDate: this.dateStr(15),
        budgetItems: [
          { name: '防水卷材', spec: 'SBS 4mm', qty: 90, unit: '㎡', unitPrice: 45 },
          { name: '商品混凝土', spec: 'C30', qty: 5, unit: 'm³', unitPrice: 480 },
        ],
      });
      await this.svc.addConstructionLog(teamUser, {
        houseId, stage: '屋面修复', content: '防水重做完成', progressPercent: 60,
        materialName: '防水卷材', materialSpec: 'SBS 4mm',
        itemId: plan.items[0].id, itemStatus: ItemStatus.DONE,
      });
      await this.svc.addConstructionLog(teamUser, {
        houseId, stage: '墙体加固', content: '墙体加固完成', progressPercent: 100,
        materialName: '商品混凝土', materialSpec: 'C30',
        itemId: plan.items[1].id, itemStatus: ItemStatus.DONE,
      });
      await this.svc.createAcceptance(acceptor, {
        houseId, comment: '合格',
        itemResults: plan.items.map((it) => ({ itemId: it.id, itemType: it.type, result: AcceptanceResult.PASS })),
      });
      await this.svc.closeHouse(county, { houseId, confirmedAllItems: true, confirmedStopUseLifted: true });
      await this.svc.createRecheck(grid3, {
        houseId, result: AcceptanceResult.FAIL, wallCrack: 2,
        reboundNotes: '复查发现原加固墙体旁出现新贯通裂缝，疑似相邻新建房施工影响，问题反弹',
      });
    }

    void teamB;
  }
}
