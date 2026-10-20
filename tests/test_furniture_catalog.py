import unittest
from scripts.update_furniture_catalog import build_plan, DESIRED, plan_digest


class CatalogPlanTests(unittest.TestCase):
    def rows(self):
        return [dict(id=i,name=n,description='cũ',active=True,tickets=0,routing=0)
                for i,n in enumerate(['Tài khoản','Kỹ thuật','Thanh toán','Khiếu nại','Khác'],1)]

    def test_initial_plan_preserves_ids_and_never_deletes(self):
        plan=build_plan(self.rows())
        self.assertEqual(sum(x['action']=='insert' for x in plan),6)
        self.assertEqual({x['id'] for x in plan if x['action']=='update'},{3,4})
        self.assertEqual({x['id'] for x in plan if x['action']=='deactivate'},{1,2,5})
        self.assertNotIn('delete',[x['action'] for x in plan])

    def test_referenced_category_is_not_renamed(self):
        for column in ['tickets','routing']:
            rows=self.rows();rows[2][column]=1
            plan=build_plan(rows)
            self.assertFalse(any(x['action']=='update' and x['id']==3 for x in plan))
            self.assertTrue(any(x['action']=='insert' and x['name']=='Thanh toán và hóa đơn' for x in plan))

    def test_repeat_plan_has_no_operations(self):
        rows=[dict(id=i,name=n,description=d,active=True,tickets=0,routing=0) for i,(n,d) in enumerate(DESIRED,10)]
        rows.extend(dict(id=i,name=n,description='cũ',active=False,tickets=0,routing=0) for i,n in [(1,'Tài khoản'),(2,'Kỹ thuật'),(5,'Khác')])
        self.assertEqual(build_plan(rows),[])

    def test_reference_change_invalidates_approved_digest(self):
        rows=self.rows();before=plan_digest(rows,build_plan(rows))
        rows[0]['tickets']=1
        self.assertNotEqual(before,plan_digest(rows,build_plan(rows)))


if __name__=='__main__':
    unittest.main()
