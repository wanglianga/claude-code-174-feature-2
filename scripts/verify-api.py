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
fails = []
def check(name, cond, detail=''):
    print(('PASS' if cond else 'FAIL'), name, detail)
    if not cond: fails.append(name)

def house_by_code(code, token):
    _, d = req('GET', '/houses?q=' + code, token)
    return d['data'][0]

# ---------- B房屋：完工照片后钢梁材料抽查全链路 ----------
b = house_by_code('NF-YL-000002', county)
arc_b = req('GET', f"/houses/{b['id']}/archive", county)[1]
plan_b = arc_b['plans'][0]
check_b = arc_b['materialChecks'][0]
results = [{'itemId': it['id'], 'itemType': it['type'], 'result': 'PASS'} for it in plan_b['items'] if it['required']]

check('B-存在钢梁材料抽查且待举证', check_b['status'] == 'OPEN' and check_b['suspectItem'] == '钢梁', check_b['status'])
check('B-抽查规格已记录', 'Q355B' in (check_b['planSpec'] or '') and 'Q235' in (check_b['foundSpec'] or ''))
# 抽查未结案组织验收 -> 拒绝（不能只凭完工照片验收）
st, d = req('POST', '/acceptances', acceptor, {'houseId': b['id'], 'itemResults': results})
check('B-抽查未结案禁止验收', st == 400 and '抽查' in d['message'], d.get('message', '')[:60])
# 补助资格校验中“材料抽查”项不通过
guards = req('GET', f"/houses/{b['id']}/subsidy-guards", county)[1]
check('B-补助校验含材料抽查闸', any(g['label'] == '材料抽查' and not g['ok'] for g in guards))
# 已批准补助在抽查未结案时禁止发放（拨付暂停）
st, d = req('POST', f"/subsidies/{arc_b['subsidy']['id']}/pay", county)
check('B-抽查期间补助暂停拨付', st == 400 and ('抽查' in d['message'] or '暂停' in d['message']), d.get('message', '')[:60])
# 施工队不能用普通进度上报绕过抽查
st, d = req('POST', '/construction-logs', team, {'houseId': b['id'], 'stage': '墙体加固', 'content': '继续施工', 'progressPercent': 100})
check('B-待举证期间禁止普通进度上报', st == 400 and '举证' in d['message'], d.get('message', '')[:60])

# 举证三要素缺一不可
st, d = req('POST', f"/material-checks/{check_b['id']}/evidence", team,
            {'invoiceDocs': [], 'siteEntryPhotos': ['/uploads/e.jpg'], 'measurementResult': 'x'})
check('B-举证缺发票被拒', st == 400)
st, d = req('POST', f"/material-checks/{check_b['id']}/evidence", team, {
    'invoiceDocs': ['/uploads/invoice.jpg'], 'siteEntryPhotos': ['/uploads/entry.jpg'],
    'measurementResult': '6根梁钢印均为Q235；卡尺实测梁高198mm、腹板厚4.5mm'})
check('B-三要素齐全可举证', st in (200, 201), str(d)[:80])
# 待判定仍不能验收
st, d = req('POST', '/acceptances', acceptor, {'houseId': b['id'], 'itemResults': results})
check('B-待判定仍禁止验收', st == 400 and '抽查' in d['message'], d.get('message', '')[:60])

# 验收人员判定偷换属实
st, d = req('POST', f"/material-checks/{check_b['id']}/verdict", acceptor,
            {'verdict': 'SWAP', 'note': '发票为Q235非标梁，与方案Q355B不符'})
check('B-判定偷换属实', st in (200, 201), str(d)[:80])
arc_b = req('GET', f"/houses/{b['id']}/archive", county)[1]
check_b = arc_b['materialChecks'][0]
check('B-房屋退回返工', b2 := (req('GET', '/houses?q=NF-YL-000002', county)[1]['data'][0]['status']) == 'REWORK', b2)
check('B-补助拨付暂停', arc_b['subsidy']['status'] == 'SUSPENDED', arc_b['subsidy']['status'])
check('B-偷换生成阻断异常', any(i['type'] == 'MATERIAL_SWAP' and i['blocksWorkflow'] and i['status'] != 'RESOLVED' for i in arc_b['issues']))
teamA = [t for t in req('GET', '/teams', county)[1] if t['name'] == '安泰农房加固施工队'][0]
check('B-施工队进入限制接单名单', teamA['restricted'] is True)
# 返工前不能提交整改（平台须先重排节点）
st, d = req('POST', f"/material-checks/{check_b['id']}/rework", team,
            {'reworkSummary': 'x', 'reworkPhotos': ['/uploads/r.jpg'], 'reworkMeasurement': ['Q355B合格']})
check('B-未重排验收节点不能提交返工', st == 400 and '验收节点' in d['message'], d.get('message', '')[:60])

# 平台重新安排验收节点与补助拨付计划
st, d = req('POST', f"/material-checks/{check_b['id']}/schedule", town2, {
    'reworkDeadline': '2026-10-20', 'newAcceptanceDate': '2026-10-22', 'newPayPlanDate': '2026-10-30'})
check('B-重排验收与拨付节点', st in (200, 201), str(d)[:80])
# 返工材料不全被拒（不能只传一张完工照片）
st, d = req('POST', f"/material-checks/{check_b['id']}/rework", team,
            {'reworkSummary': '已更换', 'reworkPhotos': ['/uploads/r.jpg'], 'reworkMeasurement': []})
check('B-返工缺实测证明被拒', st == 400)
st, d = req('POST', f"/material-checks/{check_b['id']}/rework", team, {
    'reworkSummary': '拆除6根Q235梁，全部更换为Q355B HN200×100，腹板5.6mm',
    'reworkPhotos': ['/uploads/rework1.jpg', '/uploads/rework2.jpg'],
    'reworkMeasurement': ['第三方复验：Q355B 腹板5.6mm', '材质合格单 MTC-88']})
check('B-返工整改可提交', st in (200, 201), str(d)[:80])

# 返工复验：必须对照原方案逐项确认
st, d = req('POST', f"/material-checks/{check_b['id']}/review", acceptor,
            {'itemResults': results[:1]})
check('B-复验缺项被拒（不能只凭一张照片结案）', st == 400 and '逐项' in d['message'], d.get('message', '')[:60])
bad_results = [dict(r, result='FAIL') if i == 0 else r for i, r in enumerate(results)]
st, d = req('POST', f"/material-checks/{check_b['id']}/review", acceptor, {'itemResults': bad_results})
check('B-复验任一不合格不能结案', st == 400)
st, d = req('POST', f"/material-checks/{check_b['id']}/review", acceptor,
            {'itemResults': [dict(r, note='返工后对照方案实测合格') for r in results], 'comment': '6根钢梁已更换，逐项复验合格'})
check('B-逐项复验通过并重新验收', st in (200, 201), str(d)[:80])
arc_b = req('GET', f"/houses/{b['id']}/archive", county)[1]
check_b = arc_b['materialChecks'][0]
b_status = req('GET', '/houses?q=NF-YL-000002', county)[1]['data'][0]['status']
check('B-抽查结案状态', check_b['status'] == 'REWORKED', check_b['status'])
check('B-返工后进入待销号', b_status == 'PENDING_ACCEPTANCE', b_status)
check('B-补助恢复已批准', arc_b['subsidy']['status'] == 'APPROVED', arc_b['subsidy']['status'])
check('B-阻断异常已办结', not any(i['type'] == 'MATERIAL_SWAP' and i['blocksWorkflow'] and i['status'] != 'RESOLVED' for i in arc_b['issues']))

# 限制接单解除前不能承接工程（以本户重新提交计划触发校验）
st, d = req('POST', '/construction-plans', farmer2, {
    'houseId': b['id'], 'teamId': teamA['id'],
    'startDate': '2026-10-10', 'endDate': '2026-11-01',
    'budgetItems': [{'name': '钢梁', 'spec': 'Q355B', 'qty': 1, 'unit': '根', 'unitPrice': 820}]})
check('B-限制接单施工队被拒', st == 400 and '限制接单' in d['message'], d.get('message', '')[:60])
# 无资质队伍同样被拒
bad_team = [t for t in req('GET', '/teams', county)[1] if not t['qualified']][0]
st, d = req('POST', '/construction-plans', farmer2, {
    'houseId': b['id'], 'teamId': bad_team['id'],
    'startDate': '2026-10-10', 'endDate': '2026-11-01',
    'budgetItems': [{'name': '钢梁', 'spec': 'Q355B', 'qty': 1, 'unit': '根', 'unitPrice': 820}]})
check('B-无资质施工队被拒', st == 400 and '资质' in d['message'], d.get('message', '')[:60])
# 乡镇无权解除限制（403），县级可解除
st, d = req('POST', f"/teams/{teamA['id']}/lift-restriction", town2, {'note': 'x'})
check('B-乡镇不能解除限制接单', st == 403)
st, d = req('POST', f"/teams/{teamA['id']}/lift-restriction", county, {'note': '返工复验合格，解除限制'})
check('B-县级解除限制接单', st in (200, 201) and d.get('restricted') is False, str(d)[:80])

# 复验通过后仍须销号才能发补助；完成销号后发放
st, d = req('POST', f"/subsidies/{arc_b['subsidy']['id']}/pay", county)
check('B-未销号仍禁止发补助', st == 400 and '销号' in d['message'], d.get('message', '')[:60])
st, d = req('POST', '/closes', county, {'houseId': b['id'], 'confirmedAllItems': True, 'confirmedStopUseLifted': True})
check('B-返工复验后允许销号', st in (200, 201), str(d)[:80])
st, d = req('POST', f"/subsidies/{arc_b['subsidy']['id']}/pay", county)
check('B-销号后补助发放', st in (200, 201) and d.get('status') == 'PAID', str(d)[:80])


# ---------- C房屋：拒绝整改/租户不搬，告知与开工制约 ----------
c = house_by_code('NF-QS-000003', county)
arc_c = req('GET', f"/houses/{c['id']}/archive", county)[1]
st, d = req('POST', '/notices', grid3, {'houseId': c['id'], 'method': '现场告知',
                                        'notifiedTo': ['户主'], 'acknowledged': False})
check('C-暂停使用房屋告知未签收被拒', st == 400 and '签收' in d['message'], d.get('message', '')[:60])
st, d = req('POST', '/construction-plans', farmer2, {
    'houseId': c['id'], 'teamId': teamA['id'],
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
    results = [{'itemId': it['id'], 'itemType': it['type'], 'result': 'PASS'} for it in plan2['items']]
    st, d = req('POST', '/acceptances', acceptor, {'houseId': f['id'], 'itemResults': results, 'comment': '复验合格'})
    check('F-重新验收通过', st in (200, 201), str(d)[:80])
    st, d = req('POST', '/closes', county, {'houseId': f['id'], 'confirmedAllItems': True,
                                            'confirmedStopUseLifted': True})
    check('F-允许二次销号', st in (200, 201), str(d)[:80])

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

print()
print('FAILED:', fails if fails else 'NONE')
