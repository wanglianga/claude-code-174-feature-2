import json, urllib.request, urllib.error

BASE = 'http://localhost:3000/api'

def req(method, path, token=None, data=None):
    body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(BASE + path, data=body, method=method)
    r.add_header('Content-Type', 'application/json')
    if token:
        r.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())

def login(u):
    _, d = req('POST', '/auth/login', data={'username': u, 'password': '123456'})
    return d['token']

county = login('county1'); town1 = login('town1'); town2 = login('town2')
town3 = login('town3'); grid1 = login('grid1'); grid3 = login('grid3')
acceptor = login('acceptor1'); farmer2 = login('farmer2'); team = login('team1')
team2 = login('team2')
fails = []
def check(name, cond, detail=''):
    print(('PASS' if cond else 'FAIL'), name, detail)
    if not cond: fails.append(name)

def house_by_code(code, token):
    _, d = req('GET', '/houses?q=' + code, token)
    return d['data'][0]

# ---------- B房屋：偷换材料阻断验收 ----------
b = house_by_code('NF-YL-000002', county)
arc_b = req('GET', f"/houses/{b['id']}/archive", county)[1]
plan_b = arc_b['plans'][0]
blocking = [i['type'] for i in arc_b['blockingIssues']]
check('B-偷换材料生成阻断异常', 'MATERIAL_SWAP' in blocking, str(blocking))

# 未解决材料问题前组织验收 -> 拒绝
results = [{'itemId': it['id'], 'itemType': it['type'], 'result': 'PASS'} for it in plan_b['items']]
st, d = req('POST', '/acceptances', acceptor, {'houseId': b['id'], 'itemResults': results})
check('B-阻断异常未办结禁止验收', st == 400, d.get('message', '')[:60])

# 无资质施工队不能被选择（尝试用不存在/失效队伍由乡镇创建后提交）
_, teams = req('GET', '/teams', county)[0], None
_, teamlist = req('GET', '/teams', county)
bad_team = [t for t in teamlist if not t['qualified']][0]
st, d = req('POST', '/construction-plans', farmer2, {
    'houseId': b['id'], 'teamId': bad_team['id'],
    'startDate': '2026-10-10', 'endDate': '2026-11-01',
    'budgetItems': [{'name': '防水卷材', 'spec': 'SBS 4mm', 'qty': 10, 'unit': '㎡', 'unitPrice': 45}]})
check('B-阻断异常时连提交计划也被拦截', st == 400 and '阻断' in d['message'], d.get('message', '')[:60])

# 办结材料问题（要求填写处置结果）
swap = arc_b['issues'][0]
st, d = req('POST', f"/issues/{swap['id']}/status", town2, {'status': 'RESOLVED'})
check('B-办结问题必须填处置结果', st == 400)
st, d = req('POST', f"/issues/{swap['id']}/status", town2,
            {'status': 'RESOLVED', 'resolution': '清退非标卷材，更换为SBS 4mm合格材料并复验'})
check('B-问题可办结', st == 201 or st == 200)

# B：另一次抽查——举证充分，判定不存在偷换（验证抽查通过路径不产生处罚）
st, mc_b = req('POST', '/material-checks', acceptor, {'houseId': b['id'],
    'materialName': '商品混凝土', 'actualSpec': 'C30', 'finding': '核对混凝土进场批次与强度等级'})
check('B-可发起材料抽查', st in (200, 201), str(mc_b)[:80])
st, d = req('POST', f"/material-checks/{mc_b['id']}/evidence", team, {
    'invoiceFiles': ['/uploads/inv.jpg'], 'entryPhotos': ['/uploads/en.jpg'],
    'measureResults': [{'item': '强度等级', 'expected': 'C30', 'measured': 'C30', 'conform': True}]})
check('B-施工队可提交举证', st in (200, 201), str(d)[:80])
# 举证三类材料缺一不可
st, d = req('POST', f"/material-checks/{mc_b['id']}/evidence", team,
            {'invoiceFiles': [], 'entryPhotos': [], 'measureResults': []})
check('B-重复/缺项举证被拒', st == 400)
# 越权：农户不能判定、施工队不能发起抽查
st, d = req('POST', f"/material-checks/{mc_b['id']}/verdict", farmer2,
            {'verdict': 'NOT_SWAP', 'verdictNote': 'x'})
check('权限-农户不能判定抽查', st == 403)
st, d = req('POST', '/material-checks', team, {'houseId': b['id'], 'finding': 'x'})
check('权限-施工队不能发起抽查', st == 403)
st, d = req('POST', f"/material-checks/{mc_b['id']}/verdict", acceptor,
            {'verdict': 'NOT_SWAP', 'verdictNote': '发票、进场照片与现场测量均符合C30，不存在偷换'})
check('B-判定不存在偷换不处罚', st in (200, 201) and d['status'] == 'EVIDENCE_OK', str(d)[:80])

# 补助已批准但未销号 -> 禁止发放
sub_b = arc_b['subsidy']
st, d = req('POST', f"/subsidies/{sub_b['id']}/pay", county)
check('B-未销号禁止发补助', st == 400 and '销号' in d['message'], d.get('message', '')[:60])

# ---------- C房屋：拒绝整改/租户不搬，告知与开工制约 ----------
c = house_by_code('NF-QS-000003', county)
arc_c = req('GET', f"/houses/{c['id']}/archive", county)[1]
st, d = req('POST', '/notices', grid3, {'houseId': c['id'], 'method': '现场告知',
                                        'notifiedTo': ['户主'], 'acknowledged': False})
check('C-暂停使用房屋告知未签收被拒', st == 400 and '签收' in d['message'], d.get('message', '')[:60])
st, d = req('POST', '/construction-plans', farmer2, {
    'houseId': c['id'], 'teamId': [t for t in teamlist if t['qualified']][0]['id'],
    'startDate': '2026-10-10', 'endDate': '2026-11-10',
    'budgetItems': [{'name': '拆除', 'qty': 1, 'unit': '项', 'unitPrice': 1000}]})
check('C-阻断问题+未告知禁止开工', st == 400, d.get('message', '')[:60])

# ---------- A房屋：销号+补助已发，复查通过 ----------
a = house_by_code('NF-XK-000001', county)
arc_a = req('GET', f"/houses/{a['id']}/archive", county)[1]
check('A-状态为已销号', a['status'] == 'CLOSED')
check('A-补助已发放', arc_a['subsidy']['status'] == 'PAID')
check('A-转移人员已准许返回', arc_a['evacuations'][0]['allowReturn'] is True)
# 已发补助不能重复发放
st, d = req('POST', f"/subsidies/{arc_a['subsidy']['id']}/pay", county)
check('A-补助不可重复发放', st == 400)

# ---------- E房屋：验收不通过自动生成阻断异常 ----------
e = house_by_code('NF-XK-000005', county)
arc_e = req('GET', f"/houses/{e['id']}/archive", county)[1]
check('E-验收不通过状态', e['status'] == 'ACCEPTANCE_FAILED')
check('E-验收失败阻断异常', any(i['type'] == 'ACCEPTANCE_FAIL' and i['blocksWorkflow'] for i in arc_e['issues']))
# 未处置前再次验收 -> 拒绝
plan_e = arc_e['plans'][0]
results = [{'itemId': it['id'], 'itemType': it['type'], 'result': 'PASS'} for it in plan_e['items']]
st, d = req('POST', '/acceptances', acceptor, {'houseId': e['id'], 'itemResults': results})
check('E-阻断异常未办结不能重新验收', st == 400 and '阻断' in d['message'], d.get('message', '')[:50])

# ---------- F房屋：复查反弹后重新治理并再次销号 ----------
f = house_by_code('NF-QS-000006', county)
arc_f = req('GET', f"/houses/{f['id']}/archive", county)[1]
check('F-反弹状态', f['status'] == 'REBOUND')
# 办结反弹问题 + 重新复核
reb = [i for i in arc_f['issues'] if i['type'] == 'REBOUND'][0]
req('POST', f"/issues/{reb['id']}/status", town3, {'status': 'RESOLVED', 'resolution': '协调邻户停工，重新加固'})
insp_f = arc_f['inspections'][0]
st, d = req('POST', '/reviews', town3, {
    'inspectionId': insp_f['id'], 'decision': 'RECTIFY', 'deadline': '2026-11-20',
    'items': [
        {'type': 'REINFORCE_WALL', 'description': '新增贯通裂缝墙体加固'},
        {'type': 'SET_WARNING', 'description': '邻户施工期间设置监测警示'},
    ]})
check('F-反弹房屋允许重新复核', st in (200, 201), str(d)[:80])
plan2 = d if st in (200,201) else None
if plan2:
    req('POST', '/notices', grid3, {'houseId': f['id'], 'method': '现场告知',
                                    'notifiedTo': ['户主'], 'acknowledged': True})
    for it in plan2['items']:
        req('POST', f"/rectification-items/{it['id']}/status", town3, {'status': 'DONE'})
    results = [{'itemId': it['id'], 'itemType': it['type'], 'result': 'PASS',
                'note': '对照原方案复验合格', 'photos': ['/uploads/v-acc.jpg']} for it in plan2['items']]
    # 未勾选对照原方案逐项确认 -> 拒绝
    st, d = req('POST', '/acceptances', acceptor, {'houseId': f['id'], 'itemResults': results})
    check('验收-未勾选对照原方案确认被拒', st == 400 and '逐项确认' in d['message'], d.get('message', '')[:60])
    st, d = req('POST', '/acceptances', acceptor, {'houseId': f['id'], 'confirmedAgainstPlan': True,
                                                   'itemResults': results, 'comment': '复验合格'})
    check('F-重新验收通过', st in (200, 201), str(d)[:80])
    st, d = req('POST', '/closes', county, {'houseId': f['id'], 'confirmedAllItems': True,
                                            'confirmedStopUseLifted': True})
    check('F-允许二次销号', st in (200, 201), str(d)[:80])

# ---------- G房屋：钢梁抽查偷换属实→限制接单/补助暂停/返工重排→复验恢复 ----------
g = house_by_code('NF-QS-000007', county)
arc_g = req('GET', f"/houses/{g['id']}/archive", county)[1]
check('G-偷换属实后房屋回返工状态', g['status'] == 'REWORK', g['status'])
checks_g = arc_g['materialChecks']
check('G-材料抽查记录存在', len(checks_g) >= 1, str(len(checks_g)))
mc = checks_g[0]
check('G-抽查判定偷换属实', mc['status'] == 'CONFIRMED_SWAP' and mc['verdict'] == 'CONFIRMED', mc['status'])
check('G-已重排验收节点和拨付计划',
      mc['reworkDeadline'] and mc['replannedAcceptanceDate'] and mc['replannedPaymentDate'],
      f"{mc['reworkDeadline']}/{mc['replannedAcceptanceDate']}/{mc['replannedPaymentDate']}")
# 阻断异常
check('G-偷换材料阻断异常',
      any(i['type'] == 'MATERIAL_SWAP' and i['blocksWorkflow'] and i['status'] != 'RESOLVED' for i in arc_g['issues']))
# 施工队进入限制接单名单
_, teamlist2 = req('GET', '/teams', county)
teamC = [t for t in teamlist2 if t['name'].startswith('宏固')][0]
check('G-施工队进入限制接单名单', teamC['restricted'] is True)
# 农户补助拨付暂停
sub_g = arc_g['subsidy']
check('G-补助拨付暂停', sub_g['paymentPaused'] is True and sub_g['status'] == 'SUSPENDED', sub_g['status'])
check('G-补助重排拨付计划已生成', len(sub_g.get('paymentSchedule') or []) == 3)
# 暂停期间禁止发放（即使县级也不行）
st, d = req('POST', f"/subsidies/{sub_g['id']}/pay", county)
check('G-补助暂停期间禁止发放', st == 400 and '暂停' in d['message'], d.get('message', '')[:60])
# 限制接单的施工队不能提交新施工计划（在已办结阻断的B房屋上验证，确保命中限制名单校验）
st, d = req('POST', '/construction-plans', farmer2, {
    'houseId': b['id'], 'teamId': teamC['id'],
    'startDate': '2026-10-10', 'endDate': '2026-11-01',
    'budgetItems': [{'name': '混凝土', 'spec': 'C30', 'qty': 10, 'unit': 'm³', 'unitPrice': 480}]})
check('G-限制名单施工队承接被拒', st == 400 and '限制接单' in d['message'], d.get('message', '')[:60])
# 返工状态下不能组织验收
plan_g = arc_g['plans'][0]
results_g = [{'itemId': it['id'], 'itemType': it['type'], 'result': 'PASS',
              'note': 'x', 'photos': ['/uploads/x.jpg']} for it in plan_g['items'] if it['required']]
st, d = req('POST', '/acceptances', acceptor, {'houseId': g['id'], 'confirmedAgainstPlan': True, 'itemResults': results_g})
check('G-阻断异常未办结禁止验收', st == 400 and '阻断' in d['message'], d.get('message', '')[:60])
# 未提交返工整改前不能复验
st, d = req('POST', f"/material-checks/{mc['id']}/requalify", acceptor, {'requalifyNote': 'x'})
check('G-未整改不能复验', st == 400, d.get('message', '')[:60])
# 举证缺项应被拒（新抽查时使用房屋B流程不受影响，这里直接校验证据接口）
st, d = req('POST', f"/material-checks/{mc['id']}/evidence", team2,
            {'invoiceFiles': ['/uploads/a.jpg'], 'entryPhotos': [], 'measureResults': []})
check('G-举证缺进场照片/测量结果被拒', st == 400 and ('待举证' in d['message'] or '进场照片' in d['message']), d.get('message', '')[:60])
# 施工队提交返工整改
st, d = req('POST', f"/material-checks/{mc['id']}/rework", team2, {
    'reworkDescription': '拆除6根小截面钢梁，更换为H400×200×8×13合格钢梁重新托换焊接',
    'reworkPhotos': ['/uploads/rw1.jpg', '/uploads/rw2.jpg']})
check('G-返工整改可提交', st in (200, 201), str(d)[:80])
# 复验结论必填
st, d = req('POST', f"/material-checks/{mc['id']}/requalify", acceptor, {'requalifyNote': ''})
check('G-复验结论必填', st == 400)
# 复验合格
st, d = req('POST', f"/material-checks/{mc['id']}/requalify", acceptor, {
    'requalifyNote': '对照原方案逐项实测，6根钢梁均为H400×200×8×13，托换焊接饱满，警示到位'})
check('G-返工复验通过', st in (200, 201), str(d)[:80])
# 联动解除
_, arc_g2 = req('GET', f"/houses/{g['id']}/archive", county)
teamC2 = [t for t in req('GET', '/teams', county)[1] if t['name'].startswith('宏固')][0]
check('G-解除施工队限制接单', teamC2['restricted'] is False)
sub_g2 = arc_g2['subsidy']
check('G-补助拨付恢复为已批准', sub_g2['paymentPaused'] is False and sub_g2['status'] == 'APPROVED', sub_g2['status'])
check('G-阻断异常已随复验办结', all(i['status'] == 'RESOLVED' for i in arc_g2['issues'] if i['type'] == 'MATERIAL_SWAP'))
# 必改项复验后重置为完成，可重新逐项验收（仍须勾选+逐项意见+照片）
plan_g2 = arc_g2['plans'][0]
results_g2 = [{'itemId': it['id'], 'itemType': it['type'], 'result': 'PASS',
               'note': f"对照原方案核验合格：{it['description'][:20]}", 'photos': ['/uploads/g-acc.jpg']}
              for it in plan_g2['items'] if it['required']]
st, d = req('POST', '/acceptances', acceptor,
            {'houseId': g['id'], 'confirmedAgainstPlan': True, 'itemResults': results_g2,
             'comment': '返工后对照原方案逐项验收合格'})
check('G-返工后逐项验收通过', st in (200, 201), str(d)[:100])

# ---------- 角色越权 ----------
st, d = req('POST', '/inspections', farmer2, {
    'township': '云岭乡', 'village': 'x', 'address': 'x', 'ownerName': 'x',
    'buildYear': 2000, 'floors': 1})
check('权限-农户不能登记巡查', st == 403)
st, d = req('POST', '/closes', town1, {'houseId': a['id'], 'confirmedAllItems': True,
                                       'confirmedStopUseLifted': True})
check('权限-乡镇不能销号', st == 403)

# ---------- 无Token ----------
st, d = req('GET', '/houses')
check('权限-未登录被拒', st == 401)

# ---------- 驾驶舱：暂停补助与限制名单联动 ----------
st, dash = req('GET', '/dashboard', county)
check('驾驶舱-统计返回200', st == 200)
check('驾驶舱-限制名单字段存在', 'restrictedTeamCount' in dash and isinstance(dash['restrictedTeams'], list))
check('驾驶舱-G复验合格后限制名单清零', dash['restrictedTeamCount'] == 0, str(dash['restrictedTeamCount']))
check('驾驶舱-含暂停补助统计字段', 'suspended' in dash['subsidySummary'] and 'pausedAmount' in dash['subsidySummary'])

print()
print('FAILED:', fails if fails else 'NONE')
