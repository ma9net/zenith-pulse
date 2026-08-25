import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RevenueIntelligenceDataAccess } from './revenue-intelligence-data-access';

describe('RevenueIntelligenceDataAccess', () => {
  let component: RevenueIntelligenceDataAccess;
  let fixture: ComponentFixture<RevenueIntelligenceDataAccess>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RevenueIntelligenceDataAccess],
    }).compileComponents();

    fixture = TestBed.createComponent(RevenueIntelligenceDataAccess);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
